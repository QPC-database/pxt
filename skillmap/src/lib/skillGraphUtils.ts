export interface SvgCoord {
    x: number;
    y: number;
}

interface GraphCoord {
    depth: number; // The depth of this node (distance from root)
    offset: number; // The offset of the node within the layer
}

interface GraphNode extends MapActivity, GraphCoord {
    width?: number; // The maximum subtree width from this node
    edges?: GraphCoord[][]; // Each edge is an array of (depth, offset) pairs
    parents?: GraphNode[];
}

export function orthogonalGraph(root: MapNode): GraphNode[] {
    let activities: GraphNode[] = [root as GraphNode];

    const prevChildPosition: { [key: string]: GraphCoord } = {};
    const visited: { [key: string]: boolean } = {};
    let totalOffset = 0;
    while (activities.length > 0) {
        let current = activities.shift();
        if (current && !visited[current.activityId]) {
            visited[current.activityId] = true;
            const parent = current.parents?.[0];
            if (parent) {
                const prevChild = prevChildPosition[parent.activityId] || { depth: 0, offset: 0 };
                // If we can place it horizontally do so, otherwise place at bottom of the graph
                if (prevChild.depth == 0) {
                    prevChild.depth = 1;
                    current.offset = parent.offset + prevChild.offset;
                } else {
                    totalOffset += 1
                    prevChild.offset = totalOffset;
                    current.offset = totalOffset;
                }

                current.depth = parent.depth + prevChild.depth;
                prevChildPosition[parent.activityId] = prevChild;
            } else {
                // This is a root node
                current.depth = 0;
                current.offset = 0;
            }

            // Assign the current node as the parent of its children
            const next = current.next.map((el: MapNode) => {
                let node = el as GraphNode;
                if (!node.parents) {
                    node.parents = [current!];
                } else {
                    node.parents.push(current!);
                }
                return node;
            })

            // If we have already seen this child node (attached to earlier parent)
            // 1. Increase child offset by one unit (so it's between the parents) and adjust the total if necessary
            // 2. Increase child depth if necessary (should be deeper than parent)
            next.filter(n => visited[n.activityId]).forEach(n => {
                n.offset += 1;
                totalOffset = Math.max(totalOffset, n.offset);
                n.depth = Math.max(n.depth, current!.depth + 1);
            })
            activities = next.concat(activities);
        }
    }


    const nodes = dfsArray(root as GraphNode);

    // Get map of node offsets at each level of the graph
    const offsetMap: { [key: number]: number[] } = {};
    nodes.forEach(n => {
        if (offsetMap[n.depth] == undefined) {
            offsetMap[n.depth] = [];
        }
        offsetMap[n.depth].push(n.offset);
    })

    // Shrink long leaf branches
    nodes.forEach(node => {
        if ((!node.next || node.next.length == 0) && node.parents?.length == 1) {
            const parent = node.parents[0];
            const offsets = offsetMap[node.depth];
            const siblingOffset = offsets[offsets.indexOf(node.offset) - 1];
            const distance = siblingOffset ? node.offset - siblingOffset : Math.abs(node.depth - parent.depth) + Math.abs(node.offset - parent.offset);
            if (distance > 2) {
                node.depth = parent.depth;
                node.offset = (siblingOffset || parent.offset) + 1;
            }
        }
    })

    // Calculate edge segments from parent nodes
    nodes.forEach(n => {
        if (n.parents) {
            n.edges = [];

            // We will try to flip the edge (draw vertical before horizontal) if
            // there is a parent on the horizontal axis, or more than two parents
            const tryFlipEdge = n.parents.some(p => p.offset == n.offset) || n.parents.length > 2;
            n.parents.forEach(p => {
                const edge = [{ depth: p.depth, offset: p.offset }];
                if (tryFlipEdge) {
                    // Grab node index, check the siblings to see if there is space to draw the flipped edge
                    const offsets = offsetMap[n.depth];
                    const nodeIndex = offsets.indexOf(n.offset);
                    const spaceBelow = n.offset > p.offset && !((offsets[nodeIndex + 1] - offsets[nodeIndex]) < (n.offset - p.offset));
                    const spaceAbove = n.offset < p.offset && !((offsets[nodeIndex] - offsets[nodeIndex - 1]) < (p.offset - n.offset));
                    if (spaceBelow || spaceAbove) {
                        edge.push({ depth: p.depth, offset: n.offset });
                    } else {
                        edge.push({ depth: n.depth, offset: p.offset });
                    }
                } else {
                    edge.push({ depth: n.depth, offset: p.offset });
                }
                edge.push({ depth: n.depth, offset: n.offset });
                n.edges?.push(edge);
            })
        }
    })

    return nodes;
}

// Simple tree-like layout, does not handle loops very well
export function treeGraph(root: MapActivity): GraphNode[] {
    let activities: GraphNode[] = [root as GraphNode];

    // Pass to set the width of each node
    setWidths(root as GraphNode);

    // We keep a map of how deep the graph is at this depth
    const offsetMap: { [key: number]: number } = {};
    // BFS traversal to set the offset and depth
    while (activities.length > 0) {
        let current = activities.shift();
        if (current) {
            current.depth = current.parents ? (Math.min(...current.parents.map((el: GraphNode) => el.depth)) + 1) : 0;
            if (offsetMap[current.depth] === undefined) {
                offsetMap[current.depth] = 1;
            }

            // Set the offset of the node, track it in our map
            if (!current.offset) {
                const parent = current.parents?.map((el: GraphNode) => el.offset) || [0];
                current.offset = Math.max(offsetMap[current.depth], ...parent);
                offsetMap[current.depth] = current.offset + current.width!;
            }

            // Assign this node as the parent of all children
            const next = current.next.map((el: MapNode) => {
                let node = el as GraphNode;
                if (!node.parents) {
                    node.parents = [current!];
                } else {
                    node.parents.push(current!);
                }
                return node;
            })

            activities = activities.concat(next);
        }
    }

    const nodes = bfsArray(root as GraphNode);
    nodes.forEach(n => {
        if (n.parents) {
            n.edges = [];
            n.parents.forEach(p => {
                // Edge from parent, vertically down, then horizontal to child
                n.edges?.push([ { depth: p.depth, offset: p.offset },
                    { depth: n.depth, offset: p.offset },
                    { depth: n.depth, offset: n.offset } ])
            })
        }
    })
    return nodes;
}

function setWidths(node: GraphNode): number {
    if (!node.next || node.next.length == 0) {
        node.width = 1;
    } else {
        node.width = node.next.map((el: any) => setWidths(el)).reduce((total: number, w: number) => total + w);
    }
    return node.width;
}

function bfsArray(root: GraphNode): GraphNode[] {
    let nodes = [];
    let queue = [root];
    let visited: { [key: string]: boolean } = {};
    while (queue.length > 0) {
        let current = queue.shift();
        if (current && !visited[current.activityId]) {
            visited[current.activityId] = true;
            nodes.push(current);
            queue = queue.concat(current.next as any);
        }
    }

    return nodes;
}

function dfsArray(root: GraphNode): GraphNode[] {
    let nodes = [];
    let queue = [root];
    let visited: { [key: string]: boolean } = {};
    while (queue.length > 0) {
        let current = queue.shift();
        if (current && !visited[current.activityId]) {
            visited[current.activityId] = true;
            nodes.push(current);
            queue = (current.next as any).concat(queue);
        }
    }

    return nodes;
}