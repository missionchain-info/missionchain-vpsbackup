/** One page's guide. Rendered by HelpPanel; nothing else reads this shape. */
export interface Guide {
  /** Panel heading. Usually the page name, e.g. "Swap". */
  title: string
  /** One paragraph: what this page is for. */
  intro: string
  /** Ordered steps, rendered as a numbered list. At least two — enforced by the tuple type. */
  howItWorks: readonly [string, string, ...string[]]
  /** Short practical cautions. Optional. */
  tips?: string[]
}
