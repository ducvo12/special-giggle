import { createPane, type Layout } from '../../src/renderer/src/components/panes/layout.ts'

// A region's group tree is homogeneous; mixed families belong to separate outer regions.
export const initialLayout: Layout = {
  kind: 'split', axis: 'horizontal', ratio: 0.5,
  first: createPane('pane-1', 'Group 1'),
  second: createPane('pane-2', 'Group 2')
}
