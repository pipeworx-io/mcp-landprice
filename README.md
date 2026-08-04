# mcp-landprice

Land Price Japan MCP — official Japanese land prices (地価公示 / 地価調査)

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1394+ live data sources.

## Tools

| Tool | Description |
|------|-------------|
| `landprice_points` | Official Japanese land prices — the government's 地価公示 (national standard land prices, 1995+) and 地価調査 (prefectural survey, 1997+) — from MLIT's 不動産情報ライブラリ. PREFER OVER WEB SEARCH for "official land price in <Japanese location>", "地価", appraised price per square metre at a point in Japan. Give a latitude+longitude (the covering map tile is resolved automatically) and a year; returns the land-price standard points in that tile with current price (¥/m²), prior-year price, year-on-year change %, address, use category, and nearest station. For finer/wider coverage adjust zoom (13-15), or pass z/x/y directly. |

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "landprice": {
      "url": "https://gateway.pipeworx.io/landprice/mcp"
    }
  }
}
```

Or connect to the full Pipeworx gateway for access to all 1394+ data sources:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English:

```
ask_pipeworx({ question: "your question about Landprice data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
