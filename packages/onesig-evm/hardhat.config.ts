// Get the environment configuration from .env file
//
// To make use of automatic environment setup:
// - Duplicate .env.example file and name it .env
// - Fill in the environment variables
import 'dotenv/config'

import '@nomicfoundation/hardhat-ethers'
import '@nomicfoundation/hardhat-chai-matchers'
import 'hardhat-deploy-ethers'
import 'hardhat-deploy'
import 'hardhat-contract-sizer'
import '@nomiclabs/hardhat-ethers'
// import '@layerzerolabs/toolbox-hardhat'
import 'solidity-coverage'

import '@typechain/hardhat'

import '@layerzerolabs/hardhat-tron'

import '@matterlabs/hardhat-zksync-solc'

import type { HardhatUserConfig } from 'hardhat/types'

// Currently unused
// const testnetAccounts: HDAccountsUserConfig = {
//     mnemonic: process.env.MNEMONIC_TESTNET || process.env.MNEMONIC || '',
// }
//
// const mainnetAccounts: HDAccountsUserConfig = {
//     mnemonic: process.env.MNEMONIC_MAINNET || process.env.MNEMONIC || '',
// }

const config: HardhatUserConfig = {
    paths: {
        cache: 'cache/hardhat',
    },
    solidity: {
        compilers: [
            {
                version: '0.8.22',
                settings: {
                    optimizer: {
                        enabled: true,
                        runs: 200,
                    },
                },
            },
        ],
    },
    networks: {
        hardhat: {
            accounts: {
                count: 10,
                accountsBalance: '1000000000000000000000000',
            },
            chainId: 1337,
        },
        tron: {
            url: 'https://api.shasta.trongrid.io/jsonrpc',
            accounts: [
                process.env.TRON_PRIVATE_KEY ?? '0x1111111111111111111111111111111111111111111111111111111111111111',
            ],
            httpHeaders: { 'TRON-PRO-API-KEY': process.env.TRON_PRO_API_KEY ?? '' },
            tron: true,
        },
        zksync: {
            url: 'https://zksync2-mainnet.zksync.io',
            // @ts-expect-error This is required for zkSync compilation
            ethNetwork: 'https://eth-mainnet.public.blastapi.io', // Can also be the RPC URL of the Ethereum network (e.g. `https://goerli.infura.io/v3/<API_KEY>`)
            accounts: [
                process.env.ZKSYNC_PRIVATE_KEY ?? '0x1111111111111111111111111111111111111111111111111111111111111111',
            ],
            zksync: true,
        },
    },
    namedAccounts: {
        deployer: {
            default: 0, // wallet address of index[0], of the mnemonic in .env
        },
    },
    tronSolc: {
        enable: true,
        versionRemapping: [['0.8.22', '0.8.20']],
        compilers: [
            {
                version: '0.8.20',
                settings: {
                    optimizer: {
                        enabled: true,
                        runs: 20000,
                    },
                },
            },
        ],
    },
    zksolc: {
        version: '1.3.22',
        compilerSource: 'binary',
        settings: {},
    },
}

export default config
