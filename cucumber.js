const common = {
  requireModule: ['ts-node/register'],
  require: ['features/step_definitions/**/*.ts'],
  format: ['progress-bar', 'summary'],
  paths: ['features/**/*.feature'],
  publishQuiet: true,
};

module.exports = {
  default: common,
  critico: {
    ...common,
    tags: '@critico',
  },
};
