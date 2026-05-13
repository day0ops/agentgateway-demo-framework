export const InstallAdapter = {
  generate: () => '## Lab 0: Installation\n',
  envVars: () => [{ name: 'ENTERPRISE_AGW_LICENSE_KEY', required: true, description: 'License key' }]
};
