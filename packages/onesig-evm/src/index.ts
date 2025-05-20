import { BigNumber, ethers } from 'ethers'

import { type BaseLeafData, GenerateLeafsResult } from '@layerzerolabs/onesig-core'

interface ETHTransactionCallData {
    to: string
    value: BigNumber
    data: string
}
export type ETHLeafData = BaseLeafData<string, ETHTransactionCallData>

export function evmLeafGenerator(leafs: ETHLeafData[]): GenerateLeafsResult<ETHLeafData> {
    return {
        leafs,
        encodeAddress(address) {
            return Buffer.from(address.substring(2).padStart(64, '0'), 'hex')
        },
        encodeCalls(calls: ETHTransactionCallData[]) {
            const hexString = ethers.utils.defaultAbiCoder.encode(
                ['tuple(address to, uint256 value, bytes data)[]'],
                [calls]
            )

            return Buffer.from(hexString.substring(2), 'hex')
        },
    }
}
