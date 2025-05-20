methods {
    function threshold() external returns (uint256) envfree;
    function getSigners() external returns (address[] memory) envfree;
    function isSigner(address) external returns (bool) envfree;
    function totalSigners() external  returns (uint256) envfree;

    function getSigner(uint256) external returns (address) envfree;
    function recoverSignerForIndex(bytes32,bytes,uint256) external returns (address) envfree;
}

// REACHABILITY

rule reachability(
    env e,
    method f,
    calldataarg args
) {
    requireInvariant setInvariant();
    requireInvariant thresholdGeTotalSigners();
    requireInvariant thresholdNotZero();

    f(e, args);
    satisfy true;
}

// DEFINITION

function ecrecoverAxioms() {
  // zero value:
  require (forall uint8 v. forall bytes32 r. forall bytes32 s. ecrecover(to_bytes32(0), v, r, s) == 0);
  // uniqueness of signature
  require (forall uint8 v. forall bytes32 r. forall bytes32 s. forall bytes32 h1. forall bytes32 h2.
    h1 != h2 => ecrecover(h1, v, r, s) != 0 => ecrecover(h2, v, r, s) == 0);
  // dependency on r and s
  require (forall bytes32 h. forall uint8 v. forall bytes32 s. forall bytes32 r1. forall bytes32 r2.
    r1 != r2 => ecrecover(h, v, r1, s) != 0 => ecrecover(h, v, r2, s) == 0);
  require (forall bytes32 h. forall uint8 v. forall bytes32 r. forall bytes32 s1. forall bytes32 s2.
    s1 != s2 => ecrecover(h, v, r, s1) != 0 => ecrecover(h, v, r, s2) == 0);
}

// GHOSTS

persistent ghost mapping(mathint => bytes32) ghostValues {
    init_state axiom forall mathint x. ghostValues[x] == to_bytes32(0);
}
persistent ghost mapping(bytes32 => uint256) ghostIndexes {
    init_state axiom forall bytes32 x. ghostIndexes[x] == 0;
}
persistent ghost uint256 ghostLength {
    init_state axiom ghostLength == 0;
    // assumption: it's infeasible to grow the list to these many elements.
    axiom ghostLength < max_uint256;
}
persistent ghost mathint ghostECDSArecoverCallCount {
    init_state axiom ghostECDSArecoverCallCount == 0;
}

// HOOKS
hook Sstore currentContract.signerSet._inner._values.length uint256 newLength {
    ghostLength = newLength;
}

hook Sstore currentContract.signerSet._inner._values[INDEX uint256 index] bytes32 newValue {
    ghostValues[index] = newValue;
}
hook Sstore currentContract.signerSet._inner._positions[KEY bytes32 value] uint256 newIndex {
    ghostIndexes[value] = newIndex;
}

hook Sload uint256 length currentContract.signerSet._inner._values.length {
    require ghostLength == length;
}
hook Sload bytes32 value currentContract.signerSet._inner._values[INDEX uint256 index] {
    require ghostValues[index] == value;
}
hook Sload uint256 index currentContract.signerSet._inner._positions[KEY bytes32 value] {
    require ghostIndexes[value] == index;
}
// Tracks how often ECDSA.recover() was called
hook STATICCALL(uint g, address addr, uint argsOffset, uint argsLength, uint retOffset, uint retLength) uint rc {
    if (addr == 0x1) { // ecrecover precompile address
        ghostECDSArecoverCallCount = ghostECDSArecoverCallCount + 1;
    }
}


// INVARIANTS

// helper invariant for EnumerableSet
invariant setInvariant()
    (forall uint256 index. 0 <= index && index < ghostLength => to_mathint(ghostIndexes[ghostValues[index]]) == index + 1)
    && (forall bytes32 value. ghostIndexes[value] == 0 ||
         (ghostValues[ghostIndexes[value] - 1] == value && ghostIndexes[value] >= 1 && ghostIndexes[value] <= ghostLength));

/**
 * @title Threshold Safety Invariant
 * @notice Ensures the approval threshold never exceeds total number of signers
 * @dev This invariant maintains basic operational safety by preventing
 *      an impossible-to-reach approval threshold
 */
invariant thresholdGeTotalSigners()
    threshold() <= totalSigners();

/**
 * @title Non-Zero Threshold Invariant
 * @notice Ensures the approval threshold is never set to zero
 * @dev Critical safety check to prevent approval deadlock or allow empty signatures.
 */
invariant thresholdNotZero()
    threshold() != 0;

/**
 * @title Non-Zero Address Signer Invariant
 * @notice Ensures address(0) can never be a valid signer
 * @dev Prevents potential misconfiguration
 */
invariant signerNotZero()
    !isSigner(0)
    {
        preserved {
            requireInvariant setInvariant();
        }
    }

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
rule accessControlSignerSet(
    env e,
    method f,
    calldataarg args,
    address anyAddress
) {
    mathint numberOfSigners_before = totalSigners();
    bool isSigner_before = isSigner(anyAddress);

    f(e, args);

    mathint numberOfSigners_after = totalSigners();
    bool isSigner_after = isSigner(anyAddress);

    assert (
        numberOfSigners_after != numberOfSigners_before ||
        isSigner_after != isSigner_before
    ) => (
        e.msg.sender == currentContract && f.selector == sig:setSigner(address,bool).selector
    );
}

/**
 * @title Threshold Access Control Rule
 * @notice Verifies that threshold changes can only be made by the MultiSig itself.
 * @dev Ensures any change to the threshold value:
 *      - Must come from the contract itself (msg.sender == currentContract)
 *      - Must be called through the setThreshold function
 */
rule accessControlThreshold(
    env e,
    method f,
    calldataarg args
) {
    mathint threshold_before = threshold();

    f(e, args);

    mathint threshold_after = threshold();

    assert (threshold_after != threshold_before) => e.msg.sender == currentContract && f.selector == sig:setThreshold(uint256).selector;
}

/// FUNCTIONAL CORRECTNESS ///

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
rule setSignerCorrectness(
    env e,
    address _signer,
    bool _active,
    address otherAddress
) {
    requireInvariant setInvariant();

    require otherAddress != _signer;

    bool isSigner_before = isSigner(_signer);
    mathint numberOfSigners_before = totalSigners();
    bool otherIsSigner_before = isSigner(otherAddress);

    setSigner(e, _signer, _active);

    bool isSigner_after = isSigner(_signer);
    mathint numberOfSigners_after = totalSigners();
    bool otherIsSigner_after = isSigner(otherAddress);

    assert  _active => !isSigner_before && isSigner_after;
    assert  _active => numberOfSigners_after == numberOfSigners_before + 1;
    assert  _active => _signer != 0;
    assert !_active => isSigner_before && !isSigner_after;
    assert !_active => numberOfSigners_after == numberOfSigners_before - 1;
    assert otherIsSigner_after == otherIsSigner_before;
    satisfy _active;
    satisfy !_active;
}

/**
 * @title Signature Order Verification Rule
 * @notice Verifies that recovered signers are in ascending order
 * @dev Ensures signatures are ordered by signer address
 *      to prevent signature reordering attacks
 */
rule verifySignaturesCorrectness_order(
    env e,
    bytes32 _digest,
    bytes _signature,
    uint256 index1,
    uint256 index2
) {
    require index1 < threshold() && index2 < threshold();

    address signer1 = recoverSignerForIndex(_digest, _signature, index1);
    address signer2 = recoverSignerForIndex(_digest, _signature, index2);

    verifySignatures(e, _digest, _signature);

    assert index1 < index2 => signer1 < signer2;
    assert _signature.length == 65 * threshold();
}

/**
 * @title Signature Length Verification Rule
 * @notice Verifies that signature byte length matches required size
 * @dev Ensures signature length equals threshold * 65 bytes
 *      (65 bytes = r(32) + s(32) + v(1) for each signature)
 */
rule verifySignaturesCorrectness_signatureLength(
    env e,
    bytes32 _digest,
    bytes _signature
) {
    requireInvariant thresholdNotZero();

    verifySignatures(e, _digest, _signature);

    assert _signature.length == 65 * threshold();
    satisfy threshold() > 1 && _signature.length == 65 * threshold();
}

/**
 * @title Signature Digest Uniqueness Rule
 * @notice Verifies that a signature set cannot be valid for different message digests
 * @dev Ensures signatures cannot be reused across different messages
 *      by requiring verification to revert for any different digest
 */
rule verifySignaturesCorrectness_noCollision(
    env e,
    bytes32 _digest1,
    bytes32 _digest2,
    bytes _signature
) {
    ecrecoverAxioms();
    requireInvariant setInvariant();
    requireInvariant thresholdNotZero();
    require _digest1 != _digest2;

    verifySignatures(e, _digest1, _signature);

    verifySignatures@withrevert(e, _digest2, _signature);
    bool success = !lastReverted;

    assert !success;
}

/**
 * @title Non-Empty Signature Verification Rule
 * @notice Ensures signatures being verified are non-empty
 * @dev Basic sanity check that prevents verification of empty signature sets
 */
rule verifySignaturesCorrectness_signatureNotEmpty(
    env e,
    bytes32 _digest,
    bytes _signature
) {
    requireInvariant thresholdNotZero();

    verifySignatures(e, _digest, _signature);

    assert _signature.length != 0;
}

/**
 * @title Signature Uniqueness Rule
 * @notice Verifies that each signature in a signature set corresponds to a unique signer
 * @dev Ensures that the same signature cannot be used multiple times within
 *      a single transaction verification, preventing signature reuse attacks
 */
rule verifySignaturesCorrectness_noSignatureReuse(
    env e,
    bytes32 _digest,
    bytes _signatures,
    uint256 index1,
    uint256 index2
) {
    ecrecoverAxioms();
    requireInvariant setInvariant();
    requireInvariant thresholdNotZero();

    require index1 < threshold();
    require index2 < threshold();
    require index1 != index2;

    address signer1 = recoverSignerForIndex(_digest, _signatures, index1);
    address signer2 = recoverSignerForIndex(_digest, _signatures, index2);

    verifySignatures(e, _digest, _signatures);

    // Different indices should never recover the same signer
    assert signer1 != signer2;
}

/**
 * @title Valid Signer Recovery Rule
 * @notice Verifies that all recovered addresses from signatures are valid signers
 * @dev Ensures that for any valid signature verification:
 *      - The recovered address at each index must be a registered signer
 */
rule verifySignaturesCorrectness_validSigner(
    env e,
    bytes32 _digest,
    bytes _signature,
    uint256 index
) {
    ecrecoverAxioms();
    requireInvariant setInvariant();
    requireInvariant thresholdNotZero();

    require index < threshold();

    address signer = recoverSignerForIndex(_digest, _signature, index);

    verifySignatures(e, _digest, _signature);

    assert isSigner(signer);
}

/**
 * @title Invalid Signer Reversion Rule
 * @notice Verifies that transactions with signatures from non-signers are rejected
 * @dev Ensures the verification process reverts if any signature
 *      is from an address that is not a registered signer
 */
rule verifySignaturesCorrectness_invalidSignerShouldRevert(
    env e,
    bytes32 _digest,
    bytes _signature,
    uint256 index
) {
    ecrecoverAxioms();
    requireInvariant setInvariant();
    requireInvariant thresholdNotZero();

    require index < threshold();

    address signer = recoverSignerForIndex(_digest, _signature, index);
    require !isSigner(signer);

    verifySignatures@withrevert(e, _digest, _signature);

    assert lastReverted;
}

/**
 * @title Signature Verification Count Rule
 * @notice Verifies that exactly threshold number of signatures are checked
 * @dev Ensures the ECDSA recover operation is called exactly once
 *      per required signature based on the threshold
 */
rule verifySignaturesCorrectness_signatureCheckCount(
    env e,
    bytes32 _digest,
    bytes _signature
) {
    require ghostECDSArecoverCallCount == 0;
    verifySignatures(e, _digest, _signature);
    assert ghostECDSArecoverCallCount == threshold();
}