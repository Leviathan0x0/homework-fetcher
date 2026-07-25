module.exports = function babelConfig(api) {
  api.cache(true);
  return {
    // babel-preset-expo already wires the Reanimated and expo-router plugins.
    presets: [["babel-preset-expo", { jsxImportSource: "react" }]],
  };
};
