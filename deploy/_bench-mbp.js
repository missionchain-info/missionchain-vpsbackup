/** READ-ONLY benchmark: 25 sequential chunks (today) vs one wide getLogs (proposed). */
const { JsonRpcProvider } = require('ethers')

const MBP = '0x2bfA50146C01d6c4BFA4A2550385988C2619f033'
const ALCHEMY = process.env.INDEXER_RPC_URL
const PUBLICNODE = 'https://bsc.publicnode.com'

async function bench(label, rpc, fn) {
  const p = new JsonRpcProvider(rpc, undefined, { batchMaxCount: 1 })
  const t = Date.now()
  try {
    const n = await fn(p)
    console.log(`  ${label.padEnd(46)} ${String(Date.now() - t).padStart(6)}ms   ${n} logs`)
  } catch (e) {
    console.log(`  ${label.padEnd(46)} ${String(Date.now() - t).padStart(6)}ms   FAILED: ${e.shortMessage || e.message}`)
  }
}

async function main() {
  const head = await new JsonRpcProvider(ALCHEMY).getBlockNumber()
  const from = head - 50_000
  console.log(`head ${head}, window ${from}..${head}\n`)

  for (const [name, rpc] of [['alchemy', ALCHEMY], ['publicnode', PUBLICNODE]]) {
    console.log(`── ${name} ──`)

    await bench('25 chunks of 2,000, sequential (today)', rpc, async (p) => {
      let n = 0
      for (let f = from; f <= head; f += 2001) {
        const t = Math.min(f + 2000, head)
        try { n += (await p.getLogs({ address: MBP, fromBlock: f, toBlock: t })).length } catch {}
      }
      return n
    })

    await bench('25 chunks, parallel', rpc, async (p) => {
      const jobs = []
      for (let f = from; f <= head; f += 2001) {
        const t = Math.min(f + 2000, head)
        jobs.push(p.getLogs({ address: MBP, fromBlock: f, toBlock: t }).catch(() => []))
      }
      return (await Promise.all(jobs)).flat().length
    })

    await bench('one call, 50,000-block window', rpc, async (p) =>
      (await p.getLogs({ address: MBP, fromBlock: from, toBlock: 'latest' })).length)

    await bench('one call, FULL history (block 0 -> latest)', rpc, async (p) =>
      (await p.getLogs({ address: MBP, fromBlock: 0, toBlock: 'latest' })).length)

    console.log()
  }
}
main().catch(e => { console.error(e); process.exit(1) })
