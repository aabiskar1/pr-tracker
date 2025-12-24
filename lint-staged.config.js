const lintstagedConfig = {
    '*.{js,ts,tsx,css,md,yaml,yml}': ['prettier --write'],
    '*.json': ['prettier --write'],
    'package.json': ['sort-package-json', 'prettier --write'],
    'tsconfig*.json': ['sort-package-json', 'prettier --write'],
};

export default lintstagedConfig;
