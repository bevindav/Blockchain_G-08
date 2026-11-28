require('@nomicfoundation/hardhat-ethers');
require('@nomicfoundation/hardhat-chai-matchers');
require('hardhat-gas-reporter');
require('solidity-coverage');
const { subtask, extendEnvironment } = require('hardhat/config');
const { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } = require('hardhat/builtin-tasks/task-names');

// Memakai solc-js dari npm (dipin di package-lock) agar kompilasi tidak perlu mengunduh compiler native.
subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD).setAction(async ({ solcVersion }, _, runSuper) => {
  if (solcVersion !== '0.8.24') return runSuper();
  return { compilerPath: require.resolve('solc/soljson.js'), isSolcJs: true,
    version: solcVersion, longVersion: require('solc').version() };
});

// Besu 24.x memakai timestamp yang salah ketika eth_estimateGas dijalankan pada blok "pending"
// (tag yang selalu dikirim hardhat-ethers), sehingga pengecekan deadline gagal. Ganti ke "latest".
extendEnvironment(hre => {
  if (hre.network.name !== 'besu') return;
  const provider = hre.network.provider;
  const fix = (method, params) => (method === 'eth_estimateGas' && Array.isArray(params) && params[1] === 'pending')
    ? [params[0], 'latest'] : params;
  const request = provider.request.bind(provider);
  const send = provider.send.bind(provider);
  provider.request = args => request({ ...args, params: fix(args.method, args.params) });
  provider.send = (method, params) => send(method, fix(method, params));
});

// Mnemonic development publik bawaan Hardhat. HANYA untuk private chain lokal (akun sudah didanai di genesis).
const DEV_MNEMONIC = 'test test test test test test test test test test test junk';
const besuAccounts = process.env.DEPLOYER_PRIVATE_KEY
  ? [process.env.DEPLOYER_PRIVATE_KEY]
  : { mnemonic: DEV_MNEMONIC, count: 10 };

module.exports = {
  solidity: { version: '0.8.24', settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'paris' } },
  networks: {
    localhost: { url: process.env.LOCAL_RPC_URL || 'http://127.0.0.1:8545', gas: 'auto' },
    besu: { url: process.env.BESU_RPC_URL || 'http://127.0.0.1:8545', chainId: 1337, accounts: besuAccounts, gasPrice: 0 }
  },
  gasReporter: { enabled: process.env.REPORT_GAS === 'true', currency: 'USD', noColors: true,
    outputFile: process.env.REPORT_GAS_FILE || undefined }
};
