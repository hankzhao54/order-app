// Lightweight loading skeletons. Grey placeholders with a shimmer,
// shaped roughly like the real content so the layout doesn't jump.

export function SkeletonRows({ count = 6 }) {
  return (
    <div className="skel-list" aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }).map((_, i) => (
        <div className="skel-row" key={i}>
          <div className="skel-line w60" />
          <div className="skel-pill" />
        </div>
      ))}
    </div>
  )
}

export function SkeletonCards({ count = 4 }) {
  return (
    <div aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }).map((_, i) => (
        <div className="skel-card" key={i}>
          <div className="skel-line w40" />
          <div className="skel-line w80" />
          <div className="skel-line w70" />
        </div>
      ))}
    </div>
  )
}
