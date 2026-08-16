<p align="left">
  <a href="https://tastytrade.com/">
    <img style="display: block;-webkit-user-select: none;margin: auto;background-color: hsl(0, 0%, 90%);transition: background-color 300ms;"
      src="https://images.contentstack.io/v3/assets/blt7dc2e3d4a7071563/blt59980ff796b3e36a/690ba1ce72ff6e5da3bd4b02/seo-tasty_(1).png"
      alt="tastytrade"
      width="280"
      align="left"
    />
  </a>
</p>
<p>&nbsp;</p>

<br clear="left" />

<div style="color: #ffffff;">

# allocation bot

Portfolio allocation bot for [tastytrade](https://tastytrade.com/). Rebalances equity (and other instrument) sleeves toward target weights using settled cash / buying power.

## Setup

```bash
npm install
cp .env.example .env
# edit .env with OAuth credentials
npm run build
```

## Run

```bash
npm start
# or from source
node src/index.js --strategy strategies/planA.json
node src/index.js --forever true --interval 1
```

## CLI

| Option | Description |
|--------|-------------|
| `-s, --strategy <path>` | Strategy JSON file |
| `-f, --forever [enabled]` | Run on a schedule (`true` / `false` or flag alone) |
| `-i, --interval <hours>` | Hours between cycles when forever |

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `ALLOCATION_SANDBOX` | `false` | Use sandbox API / credentials |
| `ALLOCATION_PAPER_TRADE` | `true` | Dry-run orders |
| `ALLOCATION_STEP` | `1` | Only trade assets for this step |
| `TASTY_CLIENT_SECRET` | | Live OAuth client secret |
| `TASTY_REFRESH_TOKEN` | | Live OAuth refresh token |
| `TASTY_ACCOUNT_NUMBER` | | Live account number |

Sandbox credentials use the `_SANDBOX` suffix.

## Strategy

See `strategy.example.json`. Each asset needs `symbol`, `type` (tastytrade instrument type), and `target`.

## License

MIT

</div>
