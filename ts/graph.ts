type CornerSnap = { x: optionalNumber, y: optionalNumber, edge: Edge | null, pos: optionalNumber };
type CornerJSON = { id: number, p: Point };
class CornerNode {
    id: number;
    p: Point;
    delta: Point;
    translate: boolean;
    extend: boolean;
    snap: CornerSnap;
    remove: boolean;

    constructor(id: number, x: number, y: number) {
        this.id = id;
        this.p = {
            x,
            y
        };
        this.delta = {
            x: 0,
            y: 0
        };
        this.translate = false;
        this.extend = false;
        this.snap = {
            x: null,
            y: null,
            edge: null,
            pos: null,
        };
        this.remove = false;
    }

    toJSON(): CornerJSON {
        return { id: this.id, p: this.p };
    }
}

type EdgeJSON = { id1: number, id2: number, stroke: string };
class Edge {
    id1: number;
    id2: number;
    stroke: string;
    snapOpenables: Openable[];
    constructor(id1: number, id2: number) {
        this.id1 = id1;
        this.id2 = id2;
        this.stroke = "black";
        this.snapOpenables = [];
    }
    toJSON(): EdgeJSON {
        return { id1: this.id1, id2: this.id2, stroke: this.stroke };
    }
}
type CornerNodes = {
    [key: number]: CornerNode,
};
type Edges = {
    [key1: number]: {
        [key2: number]: Edge,
    },
};
type GraphJSON = { nodes: CornerNodes, edges: Edges };
interface Graph {
    count: number,
    nodes: CornerNodes,
    edges: Edges,
    addNode: (p: Point) => number,
    removeNode: (id: number) => void,
    addEdge: (id1: number, id2: number) => Edge | null,
    removeEdge: (id1: number, id2: number) => void,
    mergeNodes: (fromId: number, toId: number) => void,
    bisect: (id: number, edge: Edge, pos: number) => void,

    getFaces: () => CornerNode[][],

    reset: () => void,

    nextEdgeToSegment: (center: Point, p: Point) => Point | null,
    closestNodeToClick: (p: Point) => optionalNumber,
    handleNodeToNodeSnap: (node: CornerNode, p: Point, extendNode: boolean) => boolean,
    handleNodeToEdgeSnap: (node: CornerNode, p: Point, extendNode: boolean) => boolean,
    handleNodeToNeighborSnap: (node: CornerNode, p: Point, extendNode: boolean, change: boolean) => optionalPoint,
    handleNodeSnap: (node: CornerNode, p: Point, extendNode: boolean) => void,

    handleClick: (e: Point) => boolean,
    handleMove: (e: Point) => boolean,
    handleUnclick: (e: Point) => void,

    draw: () => void,
    drawFaces: () => void,
    drawEdges: () => void,
    drawNodes: () => void,
    drawExtend: () => void,

    toJSON: () => GraphJSON,
};

const graph: Graph = {
    count: 0,
    nodes: {},
    edges: {},
    addNode: function (p: Point): number {
        const id: number = this.count++;
        this.nodes[id] = new CornerNode(id, p.x, p.y);

        console.log("new Node:", id);
        return id;
    },
    removeNode: function (id: number) {
        console.log("remove Node:", id);
        delete this.nodes[id];
        for (const outEdges of Object.values(this.edges)) {
            for (const edge of Object.values(outEdges)) {
                if (edge.id1 === id || edge.id2 === id) {
                    this.removeEdge(edge.id1, edge.id2);
                }
            }
        }
        delete this.edges[id];
    },
    addEdge: function (id1: number, id2: number): Edge | null {
        if (id1 === id2) {
            return null;
        }
        console.log("new Edge:", id1, id2);
        const lhsId = id1 < id2 ? id1 : id2;
        const rhsId = id1 < id2 ? id2 : id1;

        this.edges[lhsId] = this.edges[lhsId] || {};
        this.edges[lhsId]![rhsId] = this.edges[lhsId]![rhsId] || new Edge(lhsId, rhsId);

        return this.edges[lhsId]![rhsId]!;
    },
    removeEdge: function (id1: number, id2: number) {
        const lhsId = id1 < id2 ? id1 : id2;
        const rhsId = id1 < id2 ? id2 : id1;

        const outEdges = this.edges[lhsId];
        if (outEdges !== undefined) {
            const edge = outEdges[rhsId];
            if (edge !== undefined) {
                for (const openable of edge.snapOpenables) {
                    openable.snap.edge = null;
                    openable.snap.pos = null;
                    openable.snap.orientation = null;
                }
            }
            delete outEdges[rhsId];
            if (Object.keys(outEdges).length === 0) {
                delete this.edges[lhsId];
            }
        }
    },
    mergeNodes: function (fromId: number, toId: number) {
        console.log("merge:", fromId, toId);
        for (const outEdges of Object.values(this.edges)) {
            for (const edge of Object.values(outEdges)) {
                if (edge.id1 === fromId && edge.id2 !== toId) {
                    const newEdge = this.addEdge(toId, edge.id2);
                    if (newEdge !== null) {
                        newEdge.snapOpenables.push(...edge.snapOpenables);
                        for (const openable of edge.snapOpenables) {
                            openable.snap.edge = newEdge;
                            if (newEdge.id1 !== toId) {
                                openable.snap.pos = 1 - openable.snap.pos!;
                                openable.snap.orientation = (openable.snap.orientation! + 1) % 2;
                            }
                        }
                    }
                    edge.snapOpenables.length = 0;
                } else if (edge.id2 === fromId && edge.id1 !== toId) {
                    const newEdge = this.addEdge(toId, edge.id1);
                    if (newEdge !== null) {
                        newEdge.snapOpenables.push(...edge.snapOpenables);
                        for (const openable of edge.snapOpenables) {
                            if (newEdge.id1 === toId) {
                                openable.snap.pos = 1 - openable.snap.pos!;
                                openable.snap.orientation = (openable.snap.orientation! + 1) % 2;
                            }
                            openable.snap.edge = newEdge;
                        }
                    }
                    edge.snapOpenables.length = 0;
                }
            }
        }

        this.removeNode(fromId);
    },
    bisect: function (id: number, edge: Edge, pos: number) {
        console.log("bisect (%i, %i) by %i", edge.id1, edge.id2, id);

        const newEdge1 = this.addEdge(id, edge.id1);
        const newEdge2 = this.addEdge(id, edge.id2);

        for (const openable of edge.snapOpenables) {
            const firstPart = openable.snap.pos! <= pos;
            const tempEdge = firstPart ? newEdge1 : newEdge2;
            if (tempEdge !== null) {
                tempEdge.snapOpenables.push(openable);
                openable.snap.edge = tempEdge;
                openable.snap.pos = firstPart ? openable.snap.pos! / pos : (openable.snap.pos! - pos) / (1 - pos);
                if (firstPart && tempEdge.id2 !== id || !firstPart && tempEdge.id1 != id) {
                    openable.snap.pos = 1 - openable.snap.pos;
                    openable.snap.orientation = (openable.snap.orientation! + 1) % 2;
                }
            }
        }
        edge.snapOpenables.length = 0;
        this.removeEdge(edge.id1, edge.id2);
    },
    reset: function () {
        this.count = 0;
        this.nodes = {};
        this.edges = {};
    },
    nextEdgeToSegment: function (center: Point, p: Point): Point | null {
        let result: Point | null = null;
        let minDist: optionalNumber = null;
        for (const outEdges of Object.values(this.edges)) {
            for (const edge of Object.values(outEdges)) {
                const node1 = this.nodes[edge.id1]!;
                const node2 = this.nodes[edge.id2]!;

                const intersectionPoint: Point | null = getIntersectionPoint(center, p, node1.p, node2.p);
                if (intersectionPoint !== null) {
                    const dist = distance(intersectionPoint, p);
                    if (minDist === null || dist < minDist) {
                        minDist = dist;
                        result = intersectionPoint;
                    }
                }
            }
        }
        return result;
    },
    // p, the position to check; p is in node position space
    closestNodeToClick: function (p: Point): optionalNumber {
        let minDist: optionalNumber = null;
        let minId: optionalNumber = null;
        for (const node of Object.values(this.nodes)) {
            const dist = distance(p, node.p);
            if (minDist === null || dist < minDist) {
                minDist = dist;
                minId = node.id;
            }
        }
        return minId;
    },
    // snap functionality
    handleNodeToNodeSnap: function (node: CornerNode, p: Point, extendNode: boolean): boolean {
        let minDist: optionalNumber = null;
        for (const other of Object.values(this.nodes)) {
            if (!extendNode && other.id === node.id) {
                continue;
            }
            const dist = distance(other.p, projection.to(p));
            if (dist < settings.nodeExtendSize && (minDist === null || dist < minDist)) {
                minDist = dist;
                node.delta = projection.from(other.p);
                node.snap.x = other.id;
                node.snap.y = other.id;

                if (!extendNode) {
                    node.p = { x: other.p.x, y: other.p.y };
                }
            }
        }
        return minDist !== null;
    },
    handleNodeToEdgeSnap: function (node: CornerNode, p: Point, extendNode: boolean): boolean {
        const clickPos = projection.to(p);

        let minDist: optionalNumber = null;

        for (const outEdges of Object.values(this.edges)) {
            for (const edge of Object.values(outEdges)) {
                if (!extendNode && (edge.id1 === node.id || edge.id2 === node.id)) {
                    continue;
                }

                const node1 = this.nodes[edge.id1];
                const node2 = this.nodes[edge.id2];

                if (node1 === undefined || node2 === undefined) { continue; }

                const t =
                    ((node2.p.x - node1.p.x) * (clickPos.x - node1.p.x) + (node2.p.y - node1.p.y) * (clickPos.y - node1.p.y)) /
                    ((node2.p.x - node1.p.x) ** 2 + (node2.p.y - node1.p.y) ** 2);

                if (t < 0 || t > 1) {
                    continue;
                }
                const dist = Math.abs(
                    ((node2.p.x - node1.p.x) * (node1.p.y - clickPos.y) - (node1.p.x - clickPos.x) * (node2.p.y - node1.p.y)) /
                    distance(node2.p, node1.p));
                if (dist < settings.nodeExtendSize && (minDist === null || dist < minDist)) {
                    minDist = dist;

                    const proj = toNextNumber({
                        x: node1.p.x + t * (node2.p.x - node1.p.x),
                        y: node1.p.y + t * (node2.p.y - node1.p.y)
                    });

                    node.snap.edge = edge;
                    node.snap.pos = t;
                    node.delta = projection.from(proj);
                    if (!extendNode) {
                        node.p = proj;
                    }
                }
            }
        }

        if (minDist !== null) {
            const axisDist = this.handleNodeToNeighborSnap(node, p, extendNode, false);

            const node1 = this.nodes[node.snap.edge!.id1]!;
            const node2 = this.nodes[node.snap.edge!.id2]!;

            if (node.snap.x !== null &&
                node.snap.x !== node1.id &&
                node.snap.x !== node2.id &&
                (node.snap.y === null ||
                    axisDist.x! <= axisDist.y! ||
                    node.snap.y === node1.id ||
                    node.snap.y === node2.id)) {
                const otherNode = this.nodes[node.snap.x]!;
                const otherPos = (otherNode.p.x - node1.p.x) / (node2.p.x - node1.p.x);
                if (otherPos > 0 && otherPos < 1) {
                    const proj = toNextNumber({
                        x: otherNode.p.x,
                        y: node1.p.y + otherPos * (node2.p.y - node1.p.y),
                    });
                    node.snap.pos = otherPos;
                    node.delta = projection.from(proj);
                    if (!extendNode) {
                        node.p = proj;
                    }
                }
            } else if (node.snap.y !== null &&
                node.snap.y !== node1.id &&
                node.snap.y !== node2.id &&
                (node.snap.x === null ||
                    axisDist.y! < axisDist.x! ||
                    node.snap.x === node1.id ||
                    node.snap.x === node2.id)) {
                const otherNode = this.nodes[node.snap.y]!;
                const otherPos = (otherNode.p.y - node1.p.y) / (node2.p.y - node1.p.y);
                if (otherPos > 0 && otherPos < 1) {
                    const proj = toNextNumber({
                        x: node1.p.x + otherPos * (node2.p.x - node1.p.x),
                        y: otherNode.p.y,
                    });
                    node.snap.pos = otherPos;
                    node.delta = projection.from(proj);
                    if (!extendNode) {
                        node.p = proj;
                    }
                }
            } else {
                node.snap.x = null;
                node.snap.y = null;
            }
        }

        return minDist !== null;
    },
    handleNodeToNeighborSnap: function (node: CornerNode, p: Point, extendNode: boolean, change: boolean): optionalPoint {
        const clickPos = projection.to(p);
        const minDist: optionalPoint = { x: null, y: null };
        for (const other of Object.values(this.nodes)) {
            if (!extendNode && other.id === node.id) {
                continue;
            }
            const dist = { x: Math.abs(other.p.x - clickPos.x), y: Math.abs(other.p.y - clickPos.y) };
            if (dist.x < settings.nodeExtendSize && (minDist.x === null || dist.x < minDist.x) && dist.x <= dist.y) {
                minDist.x = dist.x;
                if (change) {
                    node.delta.x = projection.from(other.p).x;
                    if (!extendNode) {
                        node.p.x = other.p.x;
                    }
                }
                node.snap.x = other.id;
            } else if (dist.y < settings.nodeExtendSize && (minDist.y === null || dist.y < minDist.y) && dist.y < dist.x) {
                minDist.y = dist.y;
                if (change) {
                    node.delta.y = projection.from(other.p).y;
                    if (!extendNode) {
                        node.p.y = other.p.y;
                    }
                }
                node.snap.y = other.id;
            }
        }

        return minDist;
    },
    handleNodeSnap: function (node: CornerNode, p: Point, extendNode: boolean) {
        node.snap = { x: null, y: null, edge: null, pos: null };
        if (this.handleNodeToNodeSnap(node, p, extendNode)) {
            return;
        }
        if (this.handleNodeToEdgeSnap(node, p, extendNode)) {
            return;
        }
        const minDist = this.handleNodeToNeighborSnap(node, p, extendNode, true);

        // if no snapping happend
        const proj = toNextNumber({
            x: node.p.x + (p.x - node.delta.x) / projection.scale,
            y: node.p.y + (p.y - node.delta.y) / projection.scale
        });
        if (minDist.x === null) {
            node.snap.x = null;
            if (!extendNode) {
                node.p.x = proj.x;
                node.delta.x = projection.from(proj).x;
            } else {
                node.delta.x = p.x;
            }
        }
        if (minDist.y === null) {
            node.snap.y = null;
            if (!extendNode) {
                node.p.y = proj.y;
                node.delta.y = projection.from(proj).y;
            } else {
                node.delta.y = p.y;
            }
        }
    },
    getFaces: function (): CornerNode[][] {
        let directedEdges: [number, number][] = [];

        let allEdges: { [key: number]: number[] } = {};

        for (const outEdges of Object.values(this.edges)) {
            for (const edge of Object.values(outEdges)) {
                directedEdges.push([edge.id1, edge.id2]);
                directedEdges.push([edge.id2, edge.id1]);

                allEdges[edge.id1] = allEdges[edge.id1] || [];
                allEdges[edge.id2] = allEdges[edge.id2] || [];

                allEdges[edge.id1]!.push(edge.id2);
                allEdges[edge.id2]!.push(edge.id1);
            }
        }

        let nextEdge: { [key: number]: { [key: number]: number } } = {};
        Object.entries(allEdges).forEach(
            ([id1S, outEdges]) => {
                if (outEdges.length === 0) {
                    return;
                }
                // wtf; why can I not access the key as number here...
                const id1 = Number(id1S);
                const currNode = this.nodes[id1] as CornerNode;
                outEdges.sort(
                    (other1: number, other2: number) => {
                        const otherNode1 = this.nodes[other1] as CornerNode;
                        const otherNode2 = this.nodes[other2] as CornerNode;
                        const angle1 = Math.atan2(otherNode1.p.y - currNode.p.y, otherNode1.p.x - currNode.p.x);
                        const angle2 = Math.atan2(otherNode2.p.y - currNode.p.y, otherNode2.p.x - currNode.p.x);
                        return angle1 - angle2;
                    }
                );
                nextEdge[id1] = nextEdge[id1] || {};
                nextEdge[id1]![outEdges.at(0)!] = outEdges.at(outEdges.length - 1) as number;
                for (let idx: number = 1; idx < outEdges.length; ++idx) {
                    const id2 = outEdges[idx] as number;
                    nextEdge[id1]![id2] = outEdges.at(idx - 1) as number;
                }
            }
        );

        let result: CornerNode[][] = [];
        while (directedEdges.length > 0) {
            let currFace = result.at(result.push([]) - 1) as CornerNode[];
            const [id1, id2] = directedEdges.at(0) as [number, number];
            let currNode = this.nodes[id1] as CornerNode;
            let nextNode = this.nodes[id2] as CornerNode;

            currFace.push(currNode);
            let removeIdx: number = -1;
            while ((removeIdx = directedEdges.findIndex((val) => val.at(0) === currNode.id && val.at(1) === nextNode.id)) !== -1) {
                currFace.push(nextNode);

                directedEdges.splice(removeIdx, 1);

                const nextId = nextEdge[nextNode.id]![currNode.id] as number;
                currNode = nextNode;
                nextNode = this.nodes[nextId] as CornerNode;
            }
        }

        return result;
    },
    // e, the click position; e is in screen space
    handleClick: function (e: Point): boolean {
        let selected = false;
        const clickPos = projection.to(e);
        const nodeId = this.closestNodeToClick(clickPos);
        if (nodeId !== null) {
            const node = this.nodes[nodeId];
            if (node !== undefined) {
                const dist = distance(node.p, clickPos);
                if (dist <= settings.nodeTransSize) {
                    selected = true;
                    node.translate = true;
                    node.delta.x = e.x;
                    node.delta.y = e.y;
                } else if (dist <= settings.nodeExtendSize) {
                    selected = true;
                    node.extend = true;
                    node.delta.x = e.x;
                    node.delta.y = e.y;
                }
            }
        }
        return selected;
    },
    handleMove: function (e: Point): boolean {
        let changed = false;
        for (const node of Object.values(this.nodes)) {
            if (node.translate) {
                changed = true;

                this.handleNodeSnap(node, e, false);

                for (const outEdges of Object.values(this.edges)) {
                    for (const edge of Object.values(outEdges)) {
                        if (edge.id1 === node.id || edge.id2 === node.id) {
                            const node1 = this.nodes[edge.id1];
                            const node2 = this.nodes[edge.id2];

                            if (node1 === undefined || node2 === undefined) { continue; }

                            for (const openable of edge.snapOpenables) {
                                const proj = {
                                    x: node1.p.x + openable.snap.pos! * (node2.p.x - node1.p.x),
                                    y: node1.p.y + openable.snap.pos! * (node2.p.y - node1.p.y)
                                };
                                const shift = { x: proj.x - openable.dim.w / 2, y: proj.y };
                                openable.p = shift;
                                openable.angle = toDeg(Math.atan2(node2.p.y - node1.p.y, node2.p.x - node1.p.x)) + openable.snap.orientation! * 180;
                            }
                        }
                    }
                }

                handleRemove(e, node);
            } else if (node.extend) {
                changed = true;

                this.handleNodeSnap(node, e, true);

                handleRemove(e, node);
            }
        }
        return changed;
    },
    handleUnclick: function (e: Point) {
        for (const node of Object.values(this.nodes)) {
            if (node.remove && node.translate) {
                this.removeNode(node.id);
                continue;
            } else if (node.translate) {
                if (node.snap.x !== null && node.snap.y !== null && node.snap.x === node.snap.y && node.snap.x !== node.id) {
                    this.mergeNodes(node.id, node.snap.x);
                } else if (node.snap.edge !== null && node.snap.pos !== null) {
                    this.bisect(node.id, node.snap.edge, node.snap.pos);
                }
            } else if (node.extend && !node.remove) {
                if (node.snap.x !== null && node.snap.y !== null && node.snap.x === node.snap.y) {
                    if (node.snap.x !== node.id) {
                        this.addEdge(node.id, node.snap.x);
                    }
                } else {
                    const newId = this.addNode(
                        toNextNumber(projection.to({
                            x: node.snap.x === null && node.snap.edge === null ? e.x : node.delta.x,
                            y: node.snap.y === null && node.snap.edge === null ? e.y : node.delta.y
                        })));
                    this.addEdge(node.id, newId);
                    if (node.snap.edge !== null && node.snap.pos !== null) {
                        this.bisect(newId, node.snap.edge, node.snap.pos);
                    }
                }
            }
            node.remove = false;
            node.translate = false;
            node.extend = false;
            node.snap = { x: null, y: null, edge: null, pos: null };
            node.delta = { x: 0, y: 0 };
        }
    },
    draw: function () {
        if (settings.showRoomSize) {
            this.drawFaces();
        }

        this.drawEdges();

        if (settings.mode === Mode.Room) {
            this.drawNodes();

            this.drawExtend();
        }
    },
    drawFaces: function () {
        const faces = this.getFaces();

        ctx.fillStyle = "lightgray";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        for (const face of faces) {
            if (face.length < 2) { continue; }

            let area: number = 0;
            let mid: Point = { x: 0, y: 0 };
            let prevP: Point = face.at(0)!.p;
            for (let i = 1; i < face.length; ++i) {
                const currP: Point = face.at(i)!.p;
                area += getTrapezoidArea(prevP, currP);
                mid = {
                    x: mid.x + (prevP.x + currP.x) * (prevP.x * currP.y - currP.x * prevP.y),
                    y: mid.y + (prevP.y + currP.y) * (prevP.x * currP.y - currP.x * prevP.y),
                };
                prevP = currP;
            }
            mid = {
                x: mid.x / (6 * area),
                y: mid.y / (6 * area),
            }
            area /= 1000 * 1000;

            if (area < 1) {
                setFontSize(18, false, true);
            } else {
                setFontSize(22, false, true);
            }
            if (area <= 0) { continue; }

            ctx.fillText(area.toFixed(1) + "m²", mid.x, mid.y);
        }
        restoreDefaultContext()
    },
    drawEdges: function () {
        for (const outEdges of Object.values(this.edges)) {
            for (const edge of Object.values(outEdges)) {
                const node1 = this.nodes[edge.id1];
                const node2 = this.nodes[edge.id2];

                if (node1 === undefined || node2 === undefined) { continue; }

                if ((node1.remove && node1.translate) || (node2.remove && node2.translate)) {
                    ctx.fillStyle = "red";
                    ctx.strokeStyle = "red";
                }

                ctx.beginPath();
                ctx.moveTo(node1.p.x, node1.p.y);

                // uncomment for gaps in windows (sort openables by pos before)
                // const dist = distance(node1.p, node2.p);
                // for (const openable of edge.snapOpenables) {
                //     const relWidth = openable.dim.w / dist;
                //     const t1 = Math.max(0, openable.snap.pos - relWidth / 2);
                //     const t2 = Math.min(1, openable.snap.pos + relWidth / 2);

                //     ctx.lineTo(node1.p.x + t1 * (node2.p.x - node1.p.x), node1.p.y + t1 * (node2.p.y - node1.p.y));
                //     ctx.moveTo(node1.p.x + t2 * (node2.p.x - node1.p.x), node1.p.y + t2 * (node2.p.y - node1.p.y));
                // }

                ctx.lineTo(node2.p.x, node2.p.y);
                ctx.stroke();

                if ((!node1.remove && node1.translate) || (!node2.remove && node2.translate)) {
                    const node = node1.translate ? node2 : node1;
                    const other = node1.translate ? node1 : node2;
                    const dist = distance(node1.p, node2.p);
                    const ul = { x: -projection.p.x / projection.scale, y: -projection.p.y / projection.scale };
                    const br = projection.to({ x: canvas.width, y: canvas.height });

                    const nodeScaling = settings.nodeTransSize / dist;
                    const nodeBorder = {
                        x: node.p.x * (1 - nodeScaling) + other.p.x * nodeScaling,
                        y: node.p.y * (1 - nodeScaling) + other.p.y * nodeScaling,
                    };
                    const otherBorder = {
                        x: other.p.x * (1 - nodeScaling) + node.p.x * nodeScaling,
                        y: other.p.y * (1 - nodeScaling) + node.p.y * nodeScaling,
                    };

                    const borderPos = {
                        x: Math.min(Math.max(nodeBorder.x, ul.x), br.x),
                        y: Math.min(Math.max(nodeBorder.y, ul.y), br.y)
                    };

                    const sx = nodeBorder.x === otherBorder.x ? 1 : (borderPos.x - otherBorder.x) / (nodeBorder.x - otherBorder.x);
                    const sy = nodeBorder.y === otherBorder.y ? 1 : (borderPos.y - otherBorder.y) / (nodeBorder.y - otherBorder.y);

                    const borderScaling = Math.min(sx, sy);
                    const scaling = Math.min(sx, sy) / 2;

                    setFontSize(20, false);

                    ctx.save();
                    const b = {
                        x: otherBorder.x * (1 - borderScaling) + nodeBorder.x * borderScaling,
                        y: otherBorder.y * (1 - borderScaling) + nodeBorder.y * borderScaling,
                    };
                    const c = {
                        x: otherBorder.x * (1 - scaling) + nodeBorder.x * scaling,
                        y: otherBorder.y * (1 - scaling) + nodeBorder.y * scaling,
                    };
                    ctx.translate(c.x, c.y);
                    const angle = Math.atan2(node.p.y - other.p.y, node.p.x - other.p.x);

                    ctx.rotate(angle < -Math.PI / 2 || angle > Math.PI / 2 ? angle + Math.PI : angle);
                    ctx.fillText(dist.toFixed(1), 0, 0, distance(otherBorder, b));

                    ctx.restore();
                } else if (settings.showEdgeLabels) {
                    const dist = distance(node1.p, node2.p);

                    setFontSize(18, false);

                    ctx.save();
                    const c = {
                        x: (node1.p.x + node2.p.x) / 2,
                        y: (node1.p.y + node2.p.y) / 2,
                    };
                    ctx.translate(c.x, c.y);
                    const angle = Math.atan2(node2.p.y - node1.p.y, node2.p.x - node1.p.x);

                    ctx.rotate(angle < -Math.PI / 2 || angle > Math.PI / 2 ? angle + Math.PI : angle);
                    ctx.fillText(dist.toFixed(0), 0, 0, dist);

                    ctx.restore();
                }

                restoreDefaultContext();
            }
        }
    },
    drawNodes: function () {
        for (const node of Object.values(this.nodes)) {
            if (node.remove && node.translate) {
                ctx.fillStyle = "red";
                ctx.strokeStyle = "red";
            }

            // stroke
            ctx.beginPath();
            ctx.arc(node.p.x, node.p.y, settings.nodeExtendSize, 0, 2 * Math.PI);
            ctx.stroke();

            // fill
            ctx.beginPath();
            ctx.arc(node.p.x, node.p.y, settings.nodeTransSize, 0, 2 * Math.PI);
            ctx.fill();

            restoreDefaultContext();
        }
    },
    drawExtend: function () {
        for (const node of Object.values(this.nodes)) {
            if (node.extend) {
                const newPos = projection.to(node.delta);
                if (node.remove) {
                    ctx.fillStyle = "red";
                    ctx.strokeStyle = "red";
                } else {
                    ctx.fillStyle = "gray";
                    ctx.strokeStyle = "gray";
                }
                // stroke
                ctx.beginPath();
                ctx.arc(newPos.x, newPos.y, settings.nodeExtendSize, 0, 2 * Math.PI);
                ctx.stroke();

                // fill
                ctx.beginPath();
                ctx.arc(newPos.x, newPos.y, settings.nodeTransSize, 0, 2 * Math.PI);
                ctx.fill();

                // line
                ctx.moveTo(node.p.x, node.p.y);
                ctx.lineTo(newPos.x, newPos.y);
                ctx.stroke();

                if (!node.remove) {
                    setFontSize(20, false);

                    const dist = distance(node.p, newPos);
                    ctx.save();
                    const c = {
                        x: (node.p.x + newPos.x) / 2,
                        y: (node.p.y + newPos.y) / 2,
                    };
                    ctx.translate(c.x, c.y);
                    const angle = Math.atan2(node.p.y - newPos.y, node.p.x - newPos.x);

                    ctx.rotate(angle < -Math.PI / 2 || angle > Math.PI / 2 ? angle + Math.PI : angle);
                    ctx.fillText(dist.toFixed(1), 0, 0, dist - 2 * settings.nodeTransSize);

                    ctx.restore();
                }
            }

            restoreDefaultContext();
        }
    },
    toJSON: function (): GraphJSON {
        return { nodes: this.nodes, edges: this.edges };
    },
};
