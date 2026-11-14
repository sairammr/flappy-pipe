# Signing: one approval, then silent

Read against `@hot-labs/near-connect@0.12.0` and `near-api-js@7.5.3` as
installed in `apps/web/node_modules`. Code: `apps/web/lib/near.ts`.

## What near-connect 0.12 actually does

- The `signIn: { contractId, methodNames }` constructor option is
  `@deprecated` (`build/NearConnector.d.ts` ~L30-L40) and **is never read**:
  `build/NearConnector.js` has no reference to `options.signIn`. In 0.12,
  `signIn({contractId, methodNames})` creates no key, so we can't rely on it.
- The supported path is `connector.connect({ addFunctionCallKey })`
  (`build/NearConnector.js` L207-L270, types `build/types/index.d.ts` L27-L57).
  `AddFunctionCallKeyParams` takes **`publicKey` supplied by the dApp**, plus
  `contractId`, `allowMethods`, `gasAllowance` (default 0.25 NEAR, L229-L235).
  The wallet adds that key as part of the sign-in approval.
- When `addFunctionCallKey` is passed, the wallet picker is filtered to wallets
  whose manifest declares `signInWithFunctionCallKey` (L212-L216). With
  `network: "testnet"`, `availableWallets` also requires the `testnet` feature
  (L114-L126).
- The wallet never hands over a private key. `Account` is `{accountId, publicKey?}`
  (`types/index.d.ts` ~L58). For a wallet-held limited key, whether a later
  `signAndSendTransaction` prompts is up to each wallet's sandboxed script
  (`build/SandboxedWallet/*` runs remote code that we can't inspect). Silent
  signing with a wallet-held key is not guaranteed.

Live manifest (`hot-dao/near-selector/.../repository/manifest.json`, fetched
2026-11-14): `signInWithFunctionCallKey` + `testnet` = Meteor, Intear, Ledger,
Nightly, WalletConnect, Unity, near-cli. HOT and MyNearWallet declare the
function-call-key feature but not `testnet`, so on testnet the picker hides them.

## Chosen path: app-held key added during sign-in (1 prompt total)

1. "Play": the app generates an ed25519 `KeyPair` (near-api-js) and calls
   `connect({ addFunctionCallKey: { contractId, publicKey, allowMethods:
   {anyMethod:false, methodNames:[poke, join_free, place_chips, settle]},
   gasAllowance: 1 NEAR } })`. This is the **only** wallet approval.
2. The app checks `view_access_key` for that public key. If a wallet declared
   the feature but skipped adding the key, it falls back to one
   `signAndSendTransaction` with an `AddKey` action (a second prompt, only in
   that broken case).
3. The private key goes to `localStorage` (`riptide:session`,
   `riptide:key:<account>`) and nowhere else. Every tap is signed locally with
   `new Account(id, RPC, key).callFunction(...)`, so no wallet is involved.
4. Nonces: near-api-js 7 `Account` has a per-key `NonceManager` that reserves
   `nonce+1` locally under a lock (`lib/index.js`, `class NonceManager`
   ~L4650), so rapid taps don't collide. `signAndSendTransaction` retries on
   `InvalidNonce` after invalidating the cache (`retries` default 10,
   `account-*.d.ts` ~L1250).

Guest: `KeyPair.fromRandom` → POST `helper.testnet.near.org/account` → a
full-access key held in localStorage → the same local signing. Zero prompts.
Verified live 2026-11-14: helper returned 200, and two concurrent
`callFunction`s from the new account were signed and executed. They failed only
with `CodeDoesNotExist`, because the contract wasn't deployed yet.

Not verified: a real wallet sign-in on testnet. It needs a browser extension or
app, so a human has to try it once with Meteor or Intear.
