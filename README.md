<p align="center">
  <a href="https://layerzero.network#gh-dark-mode-only">
    <img alt="LayerZero" style="width: 50%" src="assets/logo-dark.svg#gh-dark-mode-only"/>
  </a>  
  <a href="https://layerzero.network#gh-light-mode-only">
    <img alt="LayerZero" style="width: 50%" src="assets/logo-light.svg#gh-light-mode-only"/>
  </a>
</p>

<p align="center">
  <a href="https://layerzero.network" style="color: #a77dff">Homepage</a> | <a href="https://docs.layerzero.network/" style="color: #a77dff">Docs</a> | <a href="https://layerzero.network/developers" style="color: #a77dff">Developers</a>
</p>

---

# OneSig

OneSig is a smart contract solution designed to streamline the signing and execution of arbitrary ‘calldata’ on compatible blockchains. This is achieved by introducing a pre-authorization mechanism. Instead of requiring individual multisig approvals for every transaction(most notably permissioned functions), OneSig enables pre-authorization of entire transaction batches. This eliminates the inefficiencies and delays caused by repeated approvals, reducing operational overhead and improving deployment and contract configuration scalability.

## Key Designs

For implementation reference, see [PROTOCOL.md](https://github.com/LayerZero-Labs/OneSig/blob/main/PROTOCOL.md)
