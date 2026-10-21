import { memo } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { normalizeMathDelimiters } from './math-delimiters'
import 'katex/dist/katex.min.css'

const remarkPlugins = [remarkGfm, remarkMath]
const rehypePlugins: NonNullable<React.ComponentProps<typeof Markdown>['rehypePlugins']> = [
  [rehypeKatex, { trust: false, strict: 'ignore', throwOnError: false, maxExpand: 1000, maxSize: 20 }]
]

export default memo(function FormattedResponse({ text }: { text: string }) {
  return (
    <div className="formatted-response">
      <Markdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} skipHtml
        components={{
          a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
          img: ({ alt }) => <span>{alt ? `[Image: ${alt}]` : '[Image]'}</span>
        }}
      >
        {normalizeMathDelimiters(text)}
      </Markdown>
    </div>
  )
})
