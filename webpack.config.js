const path = require("path"),
    ESLintPlugin = require("eslint-webpack-plugin"),
    pkg = require("./package");

module.exports = {
    mode: "production",
    entry: "./src/index.js",
    output: {
        path: path.resolve(__dirname, "dist"),
        filename: "cmi5.js",
        library: {
            type: "umd"
        }
    },
    plugins: [new ESLintPlugin()],
    module: {
        rules: [
            {
                test: /src\/index.js/,
                loader: "string-replace-loader",
                options: {
                    multiple: [
                        {search: "__PACKAGE_VERSION__", replace: pkg.version},
                        {search: "__PACKAGE_NAME__", replace: pkg.name},
                        {search: "__PACKAGE_DESCRIPTION__", replace: pkg.description}
                    ]
                }
            }
        ]
    }
};
