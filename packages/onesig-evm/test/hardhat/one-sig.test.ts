import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, Signer, Wallet } from 'ethers'
import { ethers } from 'hardhat'

import { Signature, compareAddresses, encodeLeaf, makeOneSigTree, signOneSigTree } from '@layerzerolabs/onesig-core'

import {
    ONE_ETHER,
    callNonExistentFunctionCall,
    createSingleTxMerkleTree,
    setBytesCall,
    signAndExecuteSingleTx,
    transferEtherCall,
} from './util'
import { evmLeafGenerator } from '../../src'
import { OneSig } from '../../typechain-types'

const OneSigIdETH = BigInt(101)
const OneSigIdBSC = BigInt(102)

describe('OneSig', () => {
    let signers: SignerWithAddress[]
    let signer1: SignerWithAddress
    let signer2: SignerWithAddress

    let executor1: SignerWithAddress
    let executor2: SignerWithAddress

    // We use Wallet instead of SignerWithAddress because we need access to the private/public keypair
    // This allows us to get the public key which is needed for Solana unit tests to verify
    // merkle proofs and transaction proofs correctly
    let sortedWallets: Wallet[]
    const threshold = 2
    const SEED = ethers.utils.keccak256(ethers.utils.randomBytes(32))

    async function setupOneSig(oneSigId = OneSigIdETH): Promise<OneSig> {
        const OneSigFactory = await ethers.getContractFactory('OneSig')
        const oneSig = await OneSigFactory.deploy(
            oneSigId,
            sortedWallets.map((s) => s.address),
            threshold,
            [executor1.address, executor2.address],
            true,
            SEED
        )
        await oneSig.deployed()
        // send some ETH to the contract for testing
        await signer1.sendTransaction({
            to: oneSig.address,
            value: ethers.utils.parseEther('100'),
        })
        return oneSig
    }

    before(async () => {
        signers = await ethers.getSigners()
        signer1 = signers[0]
        signer2 = signers[1]
        executor1 = signers[2]
        executor2 = signers[3]

        sortedWallets = [Wallet.createRandom(), Wallet.createRandom()].sort(function (a, b) {
            return compareAddresses(a.address, b.address)
        })
    })

    it('executes multiple transactions', async () => {
        const recipientA = ethers.Wallet.createRandom().address
        const recipientB = ethers.Wallet.createRandom().address

        const oneSigEth = await setupOneSig(OneSigIdETH)
        const oneSigBsc = await setupOneSig(OneSigIdBSC)
        const evmGen = evmLeafGenerator([
            // eth transactions
            {
                nonce: 0n,
                oneSigId: OneSigIdETH,
                targetOneSigAddress: oneSigEth.address,
                calls: [transferEtherCall(recipientA, ONE_ETHER), transferEtherCall(recipientA, ONE_ETHER)],
            },
            {
                nonce: 1n,
                oneSigId: OneSigIdETH,
                targetOneSigAddress: oneSigEth.address,
                calls: [transferEtherCall(recipientA, ONE_ETHER)],
            },
            {
                nonce: 2n,
                oneSigId: OneSigIdETH,
                targetOneSigAddress: oneSigEth.address,
                calls: [transferEtherCall(recipientA, ONE_ETHER)],
            },
            // bsc transactions
            {
                nonce: 0n,
                oneSigId: OneSigIdBSC,
                targetOneSigAddress: oneSigBsc.address,
                calls: [transferEtherCall(recipientB, ONE_ETHER)],
            },
        ])
        const merkleTree = makeOneSigTree([evmGen])

        const merkleRoot = merkleTree.getRoot()
        const expiry = await ethers.provider.getBlock('latest').then((block) => block.timestamp + 1000)

        const signatures = await signOneSigTree(merkleTree, sortedWallets, { seed: SEED, expiry })

        const leaves = evmGen.leafs
        // Execute transaction 0 on ETH
        let proof = merkleTree.getHexProof(encodeLeaf(evmGen, 0))
        let tx = { calls: leaves[0].calls, proof }
        await oneSigEth.connect(executor1).executeTransaction(tx, merkleRoot, expiry, signatures)
        // the first Transaction includes two calls, so the recipient should receive 2 ETH
        expect(await ethers.provider.getBalance(recipientA)).to.be.eq(ethers.utils.parseEther('2'))
        // check the nonce
        expect(await oneSigEth.nonce()).to.be.eq(1)

        // Reverts if attempting to execute while skipping nonce 1 on ETH
        proof = merkleTree.getHexProof(encodeLeaf(evmGen, 2))
        tx = { calls: leaves[2].calls, proof }
        await expect(
            oneSigEth.connect(executor1).executeTransaction(tx, merkleRoot, expiry, signatures)
        ).to.be.revertedWithCustomError(oneSigEth, 'InvalidProofOrNonce')

        // Execute transaction 1 on ETH
        proof = merkleTree.getHexProof(encodeLeaf(evmGen, 1))
        tx = { calls: leaves[1].calls, proof }
        await oneSigEth.connect(executor1).executeTransaction(tx, merkleRoot, expiry, signatures)
        // the second Transaction includes one call, so the recipient should receive 1 ETH
        expect(await ethers.provider.getBalance(recipientA)).to.be.eq(ethers.utils.parseEther('3'))
        // check the nonce
        expect(await oneSigEth.nonce()).to.be.eq(2)

        // Execute transaction 2 on ETH
        proof = merkleTree.getHexProof(encodeLeaf(evmGen, 2))
        tx = { calls: leaves[2].calls, proof }
        await oneSigEth.connect(executor1).executeTransaction(tx, merkleRoot, expiry, signatures)
        // the second Transaction includes one call, so the recipient should receive 1 ETH
        expect(await ethers.provider.getBalance(recipientA)).to.be.eq(ethers.utils.parseEther('4'))
        // check the nonce
        expect(await oneSigEth.nonce()).to.be.eq(3)

        // Execute transaction 0 on BSC
        proof = merkleTree.getHexProof(encodeLeaf(evmGen, 3))
        tx = { calls: leaves[3].calls, proof }
        await oneSigBsc.connect(executor1).executeTransaction(tx, merkleRoot, expiry, signatures)
        // the first Transaction includes one call, so the recipient should receive 1 ETH
        expect(await ethers.provider.getBalance(recipientB)).to.be.eq(ethers.utils.parseEther('1'))
        // check the nonce
        expect(await oneSigBsc.nonce()).to.be.eq(1)
    })

    it('replay protection', async () => {
        const oneSig = await setupOneSig()
        const tree = await createSingleTxMerkleTree(
            OneSigIdETH,
            oneSig.address,
            transferEtherCall(signer1.address, ONE_ETHER),
            SEED
        )
        // Sign the bundle
        const signatures = await signOneSigTree(tree.tree, sortedWallets, tree.signingData)

        // Execute the transaction
        const proof = tree.merkleTree.getHexProof(encodeLeaf(tree.generator, 0))
        const tx = { calls: tree.leaves[0].calls, proof }
        await oneSig.connect(executor1).executeTransaction(tx, tree.tree.getRoot(), tree.signingData.expiry, signatures)

        // Execute the transaction again but it should revert
        await expect(
            oneSig.connect(executor1).executeTransaction(tx, tree.tree.getRoot(), tree.signingData.expiry, signatures)
        ).to.be.revertedWithCustomError(oneSig, 'InvalidProofOrNonce')
    })

    it('invalid signatures', async () => {
        const oneSig = await setupOneSig()

        const tree = await createSingleTxMerkleTree(
            OneSigIdETH,
            oneSig.address,
            transferEtherCall(signer1.address, ONE_ETHER),
            SEED
        )
        const proof = tree.merkleTree.getHexProof(encodeLeaf(tree.generator, 0))
        const tx = { calls: tree.leaves[0].calls, proof }

        // Unknown signatures
        await expect(
            oneSig.connect(executor1).executeTransaction(tx, tree.tree.getRoot(), tree.signingData.expiry, '0x11112222')
        ).to.be.revertedWithCustomError(oneSig, 'SignatureError')

        // Sign the tree by fake signers
        const fakeSigners = [signers[2], signers[3]].sort((a, b) => compareAddresses(a.address, b.address))
        const signatures = await signOneSigTree(tree.tree, fakeSigners, tree.signingData)
        await expect(
            oneSig.connect(executor1).executeTransaction(tx, tree.tree.getRoot(), tree.signingData.expiry, signatures)
        ).to.be.revertedWithCustomError(oneSig, 'SignerNotFound')

        // Sign the tree by not reaching quorum
        const notEnoughSignatures = await signOneSigTree(tree.tree, [signer1], tree.signingData)
        await expect(
            oneSig
                .connect(executor1)
                .executeTransaction(tx, tree.tree.getRoot(), tree.signingData.expiry, notEnoughSignatures)
        ).to.be.revertedWithCustomError(oneSig, 'SignatureError')

        // Sign the tree by not sorted signers
        const singleSignatures = await Promise.all(
            sortedWallets.map(function (signer) {
                return signOneSigTree(
                    tree.tree,
                    [signer], // not sorted
                    tree.signingData
                )
            })
        )

        // Combine signatures in reverse order
        const combinedSignature = Signature.concatenateSignatures(singleSignatures.reverse(), false)

        await expect(
            oneSig
                .connect(executor1)
                .executeTransaction(tx, tree.tree.getRoot(), tree.signingData.expiry, combinedSignature.get())
        ).to.be.revertedWithCustomError(oneSig, 'UnsortedSigners')
    })

    it('atomic execution of multiple calls in a transaction', async () => {
        const oneSig = await setupOneSig()
        const recipientEth = ethers.Wallet.createRandom().address
        const balanceBefore = await ethers.provider.getBalance(recipientEth)
        const tree = await createSingleTxMerkleTree(
            OneSigIdETH,
            oneSig.address,
            [
                transferEtherCall(recipientEth, ONE_ETHER),
                transferEtherCall(recipientEth, ONE_ETHER),
                callNonExistentFunctionCall(oneSig.address), // this should revert the whole calls of this leave
            ],
            SEED
        )
        await expect(
            signAndExecuteSingleTx(oneSig, tree.tree, tree.generator, sortedWallets, tree.signingData, executor1)
        ).to.be.revertedWithCustomError(oneSig, 'ExecutionFailed')
        // the recipient should not receive any ETH
        expect(await ethers.provider.getBalance(recipientEth)).to.be.eq(balanceBefore)
    })

    it('invalid proof', async () => {
        const oneSig = await setupOneSig()

        const tree = await createSingleTxMerkleTree(
            OneSigIdETH,
            oneSig.address,
            transferEtherCall(signer1.address, ONE_ETHER),
            SEED
        )
        const signatures = await signOneSigTree(tree.tree, sortedWallets, tree.signingData)
        const proof = tree.merkleTree.getHexProof(encodeLeaf(tree.generator, 0))

        // Execute a malicious call
        await expect(
            oneSig.connect(executor1).executeTransaction(
                {
                    calls: [transferEtherCall(signer2.address, ONE_ETHER)], // different from the tree one
                    proof,
                },
                tree.tree.getRoot(),
                tree.signingData.expiry,
                signatures
            )
        ).to.be.revertedWithCustomError(oneSig, 'InvalidProofOrNonce')

        // Replace the proof with an invalid one
        await expect(
            oneSig.connect(executor1).executeTransaction(
                {
                    calls: tree.leaves[0].calls,
                    proof: [ethers.utils.keccak256('0xabcd')], // invalid proof
                },
                tree.tree.getRoot(),
                tree.signingData.expiry,
                signatures
            )
        ).to.be.revertedWithCustomError(oneSig, 'InvalidProofOrNonce')
    })

    it('tree expiry', async () => {
        const oneSig = await setupOneSig()
        const tree = await createSingleTxMerkleTree(
            OneSigIdETH,
            oneSig.address,
            transferEtherCall(signer1.address, ONE_ETHER),
            SEED
        )
        const signatures = await signOneSigTree(tree.tree, sortedWallets, tree.signingData)
        const proof = tree.merkleTree.getHexProof(encodeLeaf(tree.generator, 0))
        const tx = { calls: tree.leaves[0].calls, proof }

        // Execute the transaction after expiry
        await ethers.provider.send('evm_setNextBlockTimestamp', [
            BigNumber.from(tree.signingData.expiry).add(1).toNumber(),
        ])
        await expect(
            oneSig.connect(executor1).executeTransaction(tx, tree.tree.getRoot(), tree.signingData.expiry, signatures)
        ).to.be.revertedWithCustomError(oneSig, 'MerkleRootExpired')
    })

    it('executors test', async () => {
        const oneSig = await setupOneSig()

        expect(await oneSig.executorRequired()).to.be.eq(true)
        expect(await oneSig.getExecutors()).to.have.members([executor1.address, executor2.address])
        expect(await oneSig.isExecutor(executor1.address)).to.eq(true)
        expect(await oneSig.canExecuteTransaction(executor1.address)).to.eq(true)

        expect(await oneSig.isExecutor(sortedWallets[0].address)).to.eq(false)
        expect(await oneSig.isSigner(sortedWallets[0].address)).to.eq(true)
        expect(await oneSig.canExecuteTransaction(sortedWallets[0].address)).to.eq(true)

        const testWallet = ethers.Wallet.createRandom().address
        expect(await oneSig.isExecutor(testWallet)).to.eq(false)
        expect(await oneSig.isSigner(testWallet)).to.eq(false)
        expect(await oneSig.canExecuteTransaction(testWallet)).to.eq(false)

        const makeOneSigCall = async (call: string, nonce = 0n, executeSigner: Signer = executor1) => {
            const tree = await createSingleTxMerkleTree(
                OneSigIdETH,
                oneSig.address,
                {
                    to: oneSig.address,
                    value: BigNumber.from(0),
                    data: call,
                },
                SEED,
                nonce
            )
            const signatures = await signOneSigTree(tree.tree, sortedWallets, tree.signingData)
            const proof = tree.merkleTree.getHexProof(encodeLeaf(tree.generator, 0))

            return () =>
                oneSig.connect(executeSigner).executeTransaction(
                    {
                        calls: tree.leaves[0].calls,
                        proof,
                    },
                    tree.tree.getRoot(),
                    tree.signingData.expiry,
                    signatures
                )
        }

        const makeSetExecutorCall = (
            address: string,
            isExecutor: boolean,
            nonce = 0n,
            executeSigner: Signer = executor1
        ) => {
            return makeOneSigCall(
                oneSig.interface.encodeFunctionData('setExecutor', [address, isExecutor]),
                nonce,
                executeSigner
            )
        }

        // Add executor already added
        await expect((await makeSetExecutorCall(executor2.address, true))()).to.be.revertedWithCustomError(
            oneSig,
            'ExecutionFailed'
        )

        await (
            await makeSetExecutorCall(executor2.address, false, 0n)
        )()
        expect(await oneSig.canExecuteTransaction(executor2.address)).to.eq(false)
        expect(await oneSig.getExecutors()).not.to.include(executor2.address)

        // Signer not found
        await expect(
            (await makeSetExecutorCall(ethers.Wallet.createRandom().address, false, 1n))()
        ).to.be.revertedWithCustomError(oneSig, 'ExecutionFailed')

        await expect(
            (await makeSetExecutorCall(executor2.address, true, 1n, executor2))()
        ).to.be.revertedWithCustomError(oneSig, 'OnlyExecutorOrSigner')

        await (
            await makeSetExecutorCall(executor2.address, true, 1n)
        )()

        expect(await oneSig.canExecuteTransaction(executor2.address)).to.eq(true)
        expect(await oneSig.getExecutors()).to.include(executor2.address)

        await (
            await makeSetExecutorCall(executor2.address, false, 2n)
        )()

        await expect(oneSig.setExecutorRequired(false)).to.be.revertedWithCustomError(oneSig, 'OnlySelfCall')

        expect(await oneSig.canExecuteTransaction(executor2.address)).to.eq(false)
        expect(await oneSig.executorRequired()).to.eq(true)
        await (
            await makeOneSigCall(oneSig.interface.encodeFunctionData('setExecutorRequired', [false]), 3n)
        )()
        expect(await oneSig.executorRequired()).to.eq(false)

        for (const validExecutor of [executor1, executor2, sortedWallets[0]]) {
            expect(await oneSig.canExecuteTransaction(validExecutor.address)).to.eq(true)
        }
    })

    it('profile', async () => {
        const bytesToSet =
            '0x1234123412341234123412341234123412341234123412341234123412341234123412341234123412341234123412341234123412341234123412341234123412341234123412341234123412341234123412341234123412341234123412341234123412341234123412341234123412341234123412341234123412341234123412341234123412341234123412341234123412341234123412341234123412341234123412341234123412341234123412341234123412341234123412341234123412341234123412341234123412341234123412341234123412341234123412341234123412341234123412341234123412341234123412341234123412341234123412341234123412341234123412341234123412341234123412341234123412341234123412341234123412341234123412341234123412341234'
        const numberOfCalls = 20

        // Deploy a mock OApp used for 'calls'
        const MockOApp = await ethers.getContractFactory('MockOApp')
        const mockOApp = await MockOApp.deploy()
        await mockOApp.deployed()

        // Prepare batched calls
        const calls = Array.from({ length: numberOfCalls }, (_, i) => setBytesCall(mockOApp.address, i, bytesToSet))

        // Create the Merkle tree + metadata
        const oneSig = await setupOneSig(OneSigIdETH)
        const tree = await createSingleTxMerkleTree(OneSigIdETH, oneSig.address, calls, SEED)

        // Sign
        const signatures = await signOneSigTree(tree.tree, sortedWallets, tree.signingData)
        const proof = tree.merkleTree.getHexProof(encodeLeaf(tree.generator, 0))

        // Execute batched transaction
        const txData = {
            calls: tree.leaves[0].calls,
            proof,
        }

        const batchedTx = await oneSig
            .connect(executor1)
            .executeTransaction(txData, tree.tree.getRoot(), tree.signingData.expiry, signatures)

        await batchedTx.wait()
        // const batchedReceipt = await batchedTx.wait()
        // console.log('Batched gas used:', batchedReceipt.gasUsed.toString())

        // Check that the peer was set for all leafs
        for (let i = 0; i < numberOfCalls; i++) {
            expect(await mockOApp.bytesMapping(i)).to.be.eq(bytesToSet)
        }

        // Now lets do it directly calling the contract
        // let totalGasUsed = BigNumber.from(0)

        // // Start the 'eid' indexes in new slots so we dont accidently use existing storage slots
        // for (let i = numberOfCalls; i < numberOfCalls * 2; i++) {
        //     const manualTx = await mockOApp.setBytes(i, bytesToSet)

        //     const manualReceipt = await manualTx.wait()
        //     totalGasUsed = BigNumber.from(manualReceipt.gasUsed).add(totalGasUsed)
        // }

        // console.log('Manual gas used:', totalGasUsed.toString())
    })
})
