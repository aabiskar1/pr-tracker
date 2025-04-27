const lintstagedConfig = {
    '*.{js,ts}': ['prettier --write'],
    '*.{json,md,yaml,yml}': 'prettier --write',
    'package.json': ['prettier --write', 'sort-package-json'],
};

export default lintstagedConfig;
