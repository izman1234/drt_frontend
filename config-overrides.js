// Override react-scripts webpack-dev-server config to fix deprecation warnings:
// - DEP_WEBPACK_DEV_SERVER_ON_AFTER_SETUP_MIDDLEWARE
// - DEP_WEBPACK_DEV_SERVER_ON_BEFORE_SETUP_MIDDLEWARE
module.exports = {
  devServer: function (configFunction) {
    return function (proxy, allowedHost) {
      const config = configFunction(proxy, allowedHost);

      // Migrate deprecated middleware options to setupMiddlewares
      const onBefore = config.onBeforeSetupMiddleware;
      const onAfter = config.onAfterSetupMiddleware;
      delete config.onBeforeSetupMiddleware;
      delete config.onAfterSetupMiddleware;

      config.setupMiddlewares = (middlewares, devServer) => {
        if (onBefore) onBefore(devServer);
        if (onAfter) onAfter(devServer);
        return middlewares;
      };

      return config;
    };
  },
};
