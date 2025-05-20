import "MultiSig.spec";

// using MockCallTarget as mockCallTarget;

methods {
    function seed() external returns(bytes32) envfree;
    function nonce() external returns(uint256) envfree;
    function encodeLeaf(uint256,OneSig.Call[]) external returns (bytes32) envfree;
    function verifyTransactionProof(bytes32,OneSig.Transaction) external envfree;


    unresolved external in OneSigHarness.executeTransaction(
        OneSig.Transaction,bytes32,uint256,bytes
    ) => DISPATCH [] default HAVOC_ECF;
}

// REACHABILITY

use rule reachability;

// HOOKS

// INVARIANTS

// helper invariant for EnumerableSet
use invariant setInvariant;

/**
 * @title Threshold Safety Invariant
 * @notice Ensures the approval threshold never exceeds total number of signers
 * @dev This invariant maintains basic operational safety by preventing
 *      an impossible-to-reach approval threshold
 */
use invariant thresholdGeTotalSigners;

/**
 * @title Non-Zero Threshold Invariant
 * @notice Ensures the approval threshold is never set to zero
 * @dev Critical safety check to prevent approval deadlock or allow empty signatures.
 */
use invariant thresholdNotZero;

/**
 * @title Non-Zero Address Signer Invariant
 * @notice Ensures address(0) can never be a valid signer
 * @dev Prevents potential misconfiguration
 */
use invariant signerNotZero;

// ACCESS CONTROL

/**
 * @title Signer Set Access Control Rule
 * @notice Verifies that any state changes to signers can only be made by the MultiSig itself.
 * @dev Checks two conditions:
 *      - Changes to total number of signers
 *      - Changes to individual signer status
 * @dev Both types of changes must come from:
 *      - The MultiSig contract itself (msg.sender == currentContract)
 *      - The setSigner function specifically
 */
use rule accessControlSignerSet;

/**
 * @title Threshold Access Control Rule
 * @notice Verifies that threshold changes can only be made by the MultiSig itself.
 * @dev Ensures any change to the threshold value:
 *      - Must come from the contract itself (msg.sender == currentContract)
 *      - Must be called through the setThreshold function
 */
use rule accessControlThreshold;

/**
 * @title Seed Access Control Rule
 * @notice Verifies that seed changes can only be made by the MultiSig itself.
 * @dev Ensures any change to the seed value:
 *      - Must come from the contract itself (msg.sender == currentContract)
 *      - Must be changed through the setSeed function
 */
rule accessControlSeed(
    env e,
    method f,
    calldataarg args
) {
    bytes32 seed_before = seed();

    f(e, args);

    bytes32 seed_after = seed();

    assert seed_after != seed_before => e.msg.sender == currentContract && f.selector == sig:setSeed(bytes32).selector;
}

// STATE CHANGES

/**
 * @title Nonce Monotonicity Rule
 * @notice Verifies that transaction nonce only increases on successful execution
 * @dev Checks two properties:
 *      - Nonce increments by exactly 1 for executeTransaction
 *      - Nonce remains unchanged for all other operations
 */
rule nonceMonotonicity(
    env e,
    method f,
    calldataarg args
) {
    mathint nonce_before = nonce();

    f(e, args);

    mathint nonce_after = nonce();

    assert f.selector == sig:executeTransaction(OneSig.Transaction,bytes32,uint256,bytes).selector
        <=> nonce_before + 1 == nonce_after;
    assert f.selector != sig:executeTransaction(OneSig.Transaction,bytes32,uint256,bytes).selector
        <=> nonce_before  == nonce_after;
}

// FUNCTIONAL CORRECTNESS

/**
 * @title Signer Set State Transition Rule
 * @notice Verifies correct state transitions when adding or removing signers
 * @dev Checks the following properties:
 *      - When adding (_active == true):
 *          - Signer must not exist before and must exist after
 *          - Signer must not be address(0)
 *          - Total signers increases by 1
 *      - When removing (_active == false):
 *          - Signer must exist before and must not exist after
 *          - Total signers decreases by 1
 *      - Other addresses remain unchanged
 */
use rule setSignerCorrectness;

/**
 * @title Signature Order Verification Rule
 * @notice Verifies that recovered signers are in ascending order
 * @dev Ensures signatures are ordered by signer address
 *      to prevent signature reordering attacks
 */
use rule verifySignaturesCorrectness_order;

/**
 * @title Signature Length Verification Rule
 * @notice Verifies that signature byte length matches required size
 * @dev Ensures signature length equals threshold * 65 bytes
 *      (65 bytes = r(32) + s(32) + v(1) for each signature)
 */
use rule verifySignaturesCorrectness_signatureLength;

/**
 * @title Signature Digest Uniqueness Rule
 * @notice Verifies that a signature set cannot be valid for different message digests
 * @dev Ensures signatures cannot be reused across different messages
 *      by requiring verification to revert for any different digest
 */
use rule verifySignaturesCorrectness_noCollision;

/**
 * @title Non-Empty Signature Verification Rule
 * @notice Ensures signatures being verified are non-empty
 * @dev Basic sanity check that prevents verification of empty signature sets
 */
use rule verifySignaturesCorrectness_signatureNotEmpty;

/**
 * @title Valid Signer Recovery Rule
 * @notice Verifies that all recovered addresses from signatures are valid signers
 * @dev Ensures that for any valid signature verification:
 *      - The recovered address at each index must be a registered signer
 */
use rule verifySignaturesCorrectness_validSigner;

/**
 * @title Invalid Signer Reversion Rule
 * @notice Verifies that transactions with signatures from non-signers are rejected
 * @dev Ensures the verification process reverts if any signature
 *      is from an address that is not a registered signer
 */
use rule verifySignaturesCorrectness_invalidSignerShouldRevert;

/**
 * @title Signature Verification Count Rule
 * @notice Verifies that exactly threshold number of signatures are checked
 * @dev Ensures the ECDSA recover operation is called exactly once
 *      per required signature based on the threshold
 */
use rule verifySignaturesCorrectness_signatureCheckCount;

/**
 * @title Set Seed Correctness Rule
 * @notice Verifies that setSeed correctly updates the seed value
 * @dev Ensures the seed state variable exactly matches the input value
 *      after a successful setSeed operation
 */
rule setSeedCorrectness(
    env e,
    bytes32 _seed
) {
    setSeed(e, _seed);
    assert seed() == _seed;
}

/**
 * @title Merkle Root Expiry Rule
 * @notice Verifies that expired merkle roots cannot be used for transaction execution
 * @dev First shows a transaction can be executed before expiry,
 *      then proves the same transaction reverts after expiry using the same initial state
 */
rule merkleRootExpiryRule(
    env e1, env e2,
    OneSig.Transaction transaction,
    bytes32 root,
    uint256 expiry,
    bytes sigs
) {
    require e1.block.timestamp <= expiry;
    require e2.block.timestamp > expiry;

    // Store the state
    storage initState = lastStorage;

    // First execution at e1 (before expiry)
    executeTransaction(e1, transaction, root, expiry, sigs);

    // Try execution at e2 (after expiry) starting from the same state
    executeTransaction@withrevert(e2, transaction, root, expiry, sigs) at initState;

    assert lastReverted, "Expired merkle root should not be usable";
}

/**
 * @title Leaf Encoding Uniqueness Rule
 * @notice Verifies that different transaction parameters result in different merkle leaves
 * @dev Ensures that any change in nonce, target address, value, or data
 *      results in a unique leaf hash, preventing transaction collisions
 */
rule leafEncodingUniquenessRule(
    uint256 nonce1,
    uint256 nonce2,
    OneSig.Call[] calls1,
    OneSig.Call[] calls2
) {
    require nonce1 != nonce2
         || calls1.to != calls2.to
         || calls1.value != calls2.value
         || calls1.data != calls2.data;

    bytes32 leaf1 = encodeLeaf(nonce1, calls1);
    bytes32 leaf2 = encodeLeaf(nonce2, calls2);

    assert leaf1 != leaf2, "Different transactions must have different leaves";
}

/**
 * @title Leaf Encoding Determinism Rule
 * @notice Verifies that leaf encoding is deterministic
 * @dev Ensures identical inputs produce identical leaf hashes
 */
rule leafEncoding_determinism(
    uint256 nonce1,
    uint256 nonce2,
    OneSig.Call[] calls1
) {
    bytes32 leaf1 = encodeLeaf(nonce1, calls1);
    bytes32 leaf2 = encodeLeaf(nonce1, calls1);

    assert leaf1 == leaf2, "Identical transactions must have identical leaves";
}

/**
 * @title Transaction Execution Merkle Verification Rule
 * @notice Verifies that transaction execution properly validates merkle proofs
 * @dev Ensures transaction execution fails if either the merkle root verification
 *      or transaction proof verification fails
 */
rule executeTransactionCorrectness_merkleRootCheck(
    env e,
    OneSig.Transaction _transaction,
    bytes32 _merkleRoot,
    uint256 _expiry,
    bytes _signatures
) {
    ecrecoverAxioms();
    requireInvariant setInvariant();
    requireInvariant thresholdNotZero();
    requireInvariant thresholdGeTotalSigners();
    requireInvariant signerNotZero();

    require e.msg.value == 0;

    // Store the state
    storage initState = lastStorage;

    verifyMerkleRoot@withrevert(e, _merkleRoot, _expiry, _signatures);
    bool verifyMerkelRootReverted = lastReverted;

    verifyTransactionProof@withrevert(_merkleRoot, _transaction);
    bool verifyTransactionProofReverted = lastReverted;

    executeTransaction(e, _transaction, _merkleRoot, _expiry, _signatures);
    // bool executeTransactionReverted = lastReverted;

    // assert (verifyMerkelRootReverted || verifyTransactionProofReverted) => executeTransactionReverted;
    assert !verifyMerkelRootReverted && !verifyTransactionProofReverted;
}

persistent ghost mathint ghostCallCount{
    init_state axiom ghostCallCount == 0;
}

hook CALL(uint g, address addr, uint value, uint argsOffset, uint argsLength, uint retOffset, uint retLength) uint rc {
    ghostCallCount = ghostCallCount + 1;
}

/**
 * @title Transaction Call Execution Correctness Rule
 * @notice Verifies proper handling of call transaction execution
 * @dev Ensures that exactly calls.length CALL operation are performed
 *      - Rule tested with single call transactions and threshold = 1 for tractability
 */
rule executeTransactionCorrectness_calls(
    env e,
    OneSig.Transaction _transaction,
    bytes32 _merkleRoot,
    uint256 _expiry,
    bytes _signatures
) {
    require threshold() == 1;
    require ghostCallCount == 0;
    mathint numberOfCalls = _transaction.calls.length;

    executeTransaction(e, _transaction, _merkleRoot, _expiry, _signatures);

    assert ghostCallCount == numberOfCalls;
    satisfy ghostCallCount == numberOfCalls;
}

/**
 * @title Transaction Proof Length Validation Rule
 * @notice Verifies that transaction proofs must be non-empty when root differs from leaf
 * @dev Ensures that:
 *      - Empty proofs are rejected when merkle root != leaf
 *      - Valid proofs can exist for non-matching root/leaf pairs
 */
rule verifyTransactionProofCorrectness_proofLength(
    env e,
    bytes32 merkleRoot,
    OneSig.Transaction transaction
) {
    ecrecoverAxioms();
    bytes32 leaf = encodeLeaf(nonce(), transaction.calls);

    require merkleRoot != leaf;

    mathint proofLength = transaction.proof.length;

    verifyTransactionProof@withrevert(e, merkleRoot, transaction);
    bool verifyTransactionProofReverted = lastReverted;

    assert proofLength == 0 => verifyTransactionProofReverted;
    satisfy proofLength != 0 && !verifyTransactionProofReverted;
}

/**
 * @title Merkle Root Expiry Validation Rule
 * @notice Verifies that merkle root verification enforces expiry timestamp
 * @dev Proves that:
 *      - Verification succeeds before expiry
 *      - Verification fails after expiry
 *      - Using same initial state for both cases
 */
rule verifyMerkleRootCorrectness_expiryCheck(
    env e1,
    env e2,
    bytes32 _merkleRoot,
    uint256 _expiry,
    bytes _signatures
) {
    ecrecoverAxioms();
    requireInvariant thresholdNotZero();
    requireInvariant thresholdGeTotalSigners();
    requireInvariant signerNotZero();

    require e1.block.timestamp <= _expiry;
    require e2.block.timestamp > _expiry;

    storage initState = lastStorage;

    verifyMerkleRoot(e1, _merkleRoot, _expiry,_signatures);

    verifyMerkleRoot@withrevert(e2, _merkleRoot, _expiry,_signatures) at initState;

    assert lastReverted;
}

/**
 * @title Seed Change Invalidation Rule
 * @notice Verifies that changing the seed invalidates previously valid merkle roots
 * @dev Proves that:
 *      - A valid merkle root becomes invalid after seed change
 *      - Only applies when new seed differs from old seed
 */
rule setSeedInvalidatesMerkleRoot(
    env e,
    env e_multisig,
    bytes32 _merkleRoot,
    uint256 _expiry,
    bytes _signatures,
    bytes32 newSeed
) {
    ecrecoverAxioms();
    requireInvariant thresholdGeTotalSigners();
    requireInvariant signerNotZero();

    require threshold() == 1;

    bytes32 seed_before = seed();
    verifyMerkleRoot(e, _merkleRoot, _expiry,_signatures);

    require newSeed != seed_before;

    setSeed(e_multisig, newSeed);

    verifyMerkleRoot@withrevert(e, _merkleRoot, _expiry,_signatures);

    assert lastReverted;
}