import { createFilter } from "@rollup/pluginutils";
import { dirname, extname, resolve } from "path";
import { existsSync, readFileSync } from "fs";
import { Parser } from "acorn";
import { base, simple } from "acorn-walk";
import { extend } from "acorn-jsx-walk";


module.exports = (options = {}) => {
  const filter = createFilter(options.include),
    isProduction = process.env.NODE_ENV === "production",
    extensions = [ ".js", ".jsx", ".ts", ".tsx" ],
    loaderName = "?solid-hot-loader",
    JSXParser = Parser.extend(require("acorn-jsx")()),
    acornOpts = { "sourceType": "module", "ecmaVersion": "2020" };

  extend(base);

  return {
    name: "solidHotLoader",

    resolveId: async function(importee, importer) {
      if (isProduction || !importer || importer.includes(loaderName)) {
        return null;
      }

      const id = resolve(dirname(importer), importee);
      if (extname(id) === "") {
        for (const ext of extensions) {
          const file = `${id}${ext}`;
          if (filter(file) && existsSync(file)) {
            return `${file}${loaderName}`;
          }
        }
      } else {
        if (filter(id)) {
          return `${id}${loaderName}`;
        }
      }

      return null;
    },

    load: async function(id) {
      if (!isProduction && id.endsWith(loaderName)) {
        let file = id.replace(loaderName, ""),
          code = readFileSync(file, "utf-8"),
          ast = JSXParser.parse(code, acornOpts),
          namedExport = "",
          otherNamedExports = "";

        simple(ast, {
          ExportDefaultDeclaration(node) {
            namedExport = `, Wrapped as ${node.declaration.name}`;
          }
        });

        simple(ast, {
          ExportNamedDeclaration(node) {
            const names = node.declaration.declarations.map(declaration => {
              return declaration.id.name;
            });
            otherNamedExports += `, ${names[0]}`;// JSON.stringify(node.declarations)}`;
          }
        });

        otherNamedExports = otherNamedExports.replace(/^,/, '');

        return `
          import { createSignal, untrack } from "solid-js";
          import Comp ${otherNamedExports ? ", { " + otherNamedExports + " } " : ""} from "${file}";
          const [s, set] = createSignal(Comp),
            Wrapped = props => {
              let c;
              return () => (c = s()) && untrack(() => c(props));
            };

          export { Wrapped as default${namedExport}, ${ otherNamedExports } };

          module && module.hot && module.hot.accept(({disposed}) => {
            for(const id of disposed.filter(id => id != module.id)) {
              require(id);
            }
            set(Comp);
          });
        `;
      }

      return null;
    },

    transform: async function(code, id) {
      if (!isProduction && !filter(id) && this.getModuleInfo(id).isEntry) {
        code = `
          module && module.hot && module.hot.accept(() => location.reload());
          ${code}
        `;
      }

      return { code };
    }
  };
};
