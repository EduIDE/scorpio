//@ts-check
"use strict";

/** @typedef {import('webpack').Configuration} WebpackConfig **/

const path = require("path");

/** @type WebpackConfig */
const extensionConfig = {
  mode: "none",
  target: "node",
  entry: {
    extension: "./src/extension.ts",
  },
  output: {
    filename: "[name].js",
    path: path.join(__dirname, "dist"),
    libraryTarget: "commonjs",
    devtoolModuleFilenameTemplate: "../[resource-path]",
  },
  resolve: {
    mainFields: ["main", "module"],
    extensions: [".ts", ".js"],
    alias: {
      // The UMD build loads its submodules with a require webpack cannot follow.
      "jsonc-parser": path.join(__dirname, "node_modules/jsonc-parser/lib/esm/main.js"),
    },
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: "ts-loader",
          },
        ],
      },
    ],
  },
  externals: {
    vscode: "commonjs vscode",
  },
  performance: {
    hints: false,
  },
  devtool: "nosources-source-map",
  infrastructureLogging: {
    level: "log",
  },
};

module.exports = [extensionConfig];
