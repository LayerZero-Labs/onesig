import { Block } from '@ethersproject/abstract-provider'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { BigNumber } from 'ethers'
import { ethers } from 'hardhat'

import {
    GenerateLeafsResult,
    MerkleTree,
    SigningOptions,
    type TypedDataSigner,
    encodeLeaf,
    makeOneSigTree,
    signOneSigTree,
} from '@layerzerolabs/onesig-core'

import { ETHLeafData, evmLeafGenerator } from '../../src'
import { MockOApp__factory, OneSig, OneSig__factory } from '../../typechain-types'

export type TransactionCall = {
    to: string
    value: BigNumber
    data: string
}

export async function createSingleTxMerkleTree(
    oneSigId: bigint,
    targetOneSigAddress: string,
    calls: TransactionCall[] | TransactionCall,
    seed: string | Uint8Array,
    nonce = 0n
) {
    const gen = evmLeafGenerator([
        { nonce, oneSigId: BigInt(oneSigId), targetOneSigAddress, calls: Array.isArray(calls) ? calls : [calls] },
    ])
    const expiry = await ethers.provider.getBlock('latest').then((block: Block) => block.timestamp + 1000)
    const tree = makeOneSigTree([gen])
    const signingData: SigningOptions = { seed, expiry }
    return { tree, merkleTree: tree, leaves: gen.leafs, signingData, generator: gen }
}

export async function signAndExecuteSingleTx(
    oneSig: OneSig,
    tree: MerkleTree,
    generator: GenerateLeafsResult<ETHLeafData>,
    signers: TypedDataSigner[],
    signingData: SigningOptions,
    executor: SignerWithAddress
) {
    const signatures = await signOneSigTree(tree, signers, signingData)
    const proof = tree.getHexProof(encodeLeaf(generator, 0))
    await oneSig
        .connect(executor)
        .executeTransaction({ calls: generator.leafs[0].calls, proof }, tree.getRoot(), signingData.expiry, signatures)
}

export const ONE_ETHER = ethers.utils.parseEther('1')

export function transferEtherCall(to: string, value: BigNumber): TransactionCall {
    return {
        to,
        value,
        data: '0x',
    }
}

export function setBytesCall(oAppAddress: string, dstEid: number, bytesString: string): TransactionCall {
    return {
        to: oAppAddress,
        value: BigNumber.from(0),
        data: MockOApp__factory.createInterface().encodeFunctionData('setBytes', [dstEid, bytesString]),
    }
}

export function setSeedCall(oneSigAddress: string, seed: Uint8Array | string): TransactionCall {
    return {
        to: oneSigAddress,
        value: BigNumber.from(0),
        data: OneSig__factory.createInterface().encodeFunctionData('setSeed', [seed]),
    }
}

export function callNonExistentFunctionCall(to: string): TransactionCall {
    return {
        to,
        value: BigNumber.from(0),
        data: '0x12345678',
    }
}
