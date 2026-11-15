/**
 * Where each session stands on the sessions map (blueprint 6.9, item 26). Plain arithmetic with no
 * drawing in it, so the same sessions always give the same picture and a test can check it.
 *
 * The main conversation stands alone in the top row. Under it come the columns: first the sessions
 * the main conversation opened, then one column per team, then the sessions without a team. Within a
 * column each session is followed by the sessions it opened, one step lower and one step to the right,
 * so whoever opened a session is always above it. A column that grows long continues in a second one
 * beside it.
 */

export interface MapSession {
	id: string;
	groupId: string | null;
	parentId: string | null;
	createdAt: number;
}

export interface MapGroup {
	id: string;
	position: number;
}

export interface MapNode {
	id: string;
	x: number;
	y: number;
	/** How many sessions stand between this one and the top of its tree. */
	depth: number;
	/** The session that opened it, when that one is on the map. */
	parentId: string | null;
}

/** A column's heading: a team, the sessions without one, or what the main conversation opened. */
export interface MapColumn {
	kind: "main" | "team" | "none";
	groupId: string | null;
	x: number;
	y: number;
	width: number;
}

export interface MapLayout {
	nodes: MapNode[];
	columns: MapColumn[];
	width: number;
	height: number;
}

/** One session and the sessions it opened, for the list that says the same as the picture. */
export interface OutlineItem {
	id: string;
	children: OutlineItem[];
}

export const NODE_W = 184;
export const NODE_H = 36;
export const ROW_GAP = 10;
export const INDENT = 22;
export const COLUMN_GAP = 36;
export const HEAD_H = 26;
export const PAD = 16;
/** A column holds this many rows before it continues beside itself. */
export const MAX_ROWS = 12;
const ROW = NODE_H + ROW_GAP;

const byAge = (a: MapSession, b: MapSession) =>
	a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Who opened whom, among the sessions given: the sessions nobody on the map opened, and each
 * session's children, oldest first. A session whose opener is missing (archived, deleted) stands on its
 * own; one that would open itself through a loop does too.
 */
function family(sessions: MapSession[]): {
	roots: MapSession[];
	children: Map<string, MapSession[]>;
} {
	const sorted = [...sessions].sort(byAge);
	const byId = new Map(sorted.map((session) => [session.id, session]));
	const loops = (session: MapSession): boolean => {
		const seen = new Set([session.id]);
		let at = session.parentId;
		while (at !== null && byId.has(at)) {
			if (seen.has(at)) return true;
			seen.add(at);
			at = byId.get(at)?.parentId ?? null;
		}
		return false;
	};
	const roots: MapSession[] = [];
	const children = new Map<string, MapSession[]>();
	for (const session of sorted) {
		const parent = session.parentId;
		if (parent === null || !byId.has(parent) || loops(session)) roots.push(session);
		else children.set(parent, [...(children.get(parent) ?? []), session]);
	}
	return { roots, children };
}

/** The same tree the picture draws, as nested items: the main conversation first, then by age. */
export function outline(sessions: MapSession[], mainId: string | null): OutlineItem[] {
	const { roots, children } = family(sessions);
	const item = (session: MapSession): OutlineItem => ({
		id: session.id,
		children: (children.get(session.id) ?? []).map(item),
	});
	return [
		...roots.filter((session) => session.id === mainId),
		...roots.filter((session) => session.id !== mainId),
	].map(item);
}

export function layoutMap(
	sessions: MapSession[],
	groups: MapGroup[],
	mainId: string | null,
): MapLayout {
	const { roots, children } = family(sessions);
	const main = roots.find((session) => session.id === mainId) ?? null;
	const nodes: MapNode[] = [];
	const columns: MapColumn[] = [];
	/** A session and everything under it, in the order it is listed, with each one's depth. */
	const rows = (session: MapSession, depth: number): { session: MapSession; depth: number }[] => [
		{ session, depth },
		...(children.get(session.id) ?? []).flatMap((child) => rows(child, depth + 1)),
	];

	let x = PAD;
	let bottom = PAD;
	const top = main ? PAD + ROW + ROW_GAP : PAD;
	if (main) {
		nodes.push({ id: main.id, x: PAD, y: PAD, depth: 0, parentId: null });
		bottom = PAD + NODE_H;
	}

	/**
	 * One column of trees under a heading. Trees are placed whole; when the next one would pass
	 * MAX_ROWS, the column continues to the right. What the main conversation opened (`under`) stands
	 * one step in, so the line down from it runs clear, and stays in one column, so that line never
	 * has to cross another session.
	 */
	const place = (
		kind: MapColumn["kind"],
		groupId: string | null,
		trees: MapSession[],
		under: string | null,
	) => {
		if (trees.length === 0) return;
		const start = x;
		const first = top + HEAD_H;
		let used = 0;
		let widest = 0;
		for (const tree of trees) {
			const list = rows(tree, under ? 1 : 0);
			if (!under && used > 0 && used + list.length > MAX_ROWS) {
				x += widest + COLUMN_GAP;
				used = 0;
				widest = 0;
			}
			for (const { session, depth } of list) {
				const shift = depth * INDENT;
				nodes.push({
					id: session.id,
					x: x + shift,
					y: first + used * ROW,
					depth,
					parentId: session.id === tree.id ? under : session.parentId,
				});
				widest = Math.max(widest, shift + NODE_W);
				used++;
				bottom = Math.max(bottom, first + used * ROW - ROW_GAP);
			}
		}
		const inset = under ? INDENT : 0;
		columns.push({ kind, groupId, x: start + inset, y: top, width: x + widest - start - inset });
		x += widest + COLUMN_GAP;
	};

	if (main) place("main", null, children.get(main.id) ?? [], main.id);
	const rest = roots.filter((session) => session !== main);
	const known = new Set(groups.map((group) => group.id));
	const teams = [...groups].sort(
		(a, b) => a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
	);
	for (const team of teams) {
		place(
			"team",
			team.id,
			rest.filter((session) => session.groupId === team.id),
			null,
		);
	}
	place(
		"none",
		null,
		rest.filter((session) => session.groupId === null || !known.has(session.groupId)),
		null,
	);

	const right = Math.max(PAD + NODE_W, ...nodes.map((node) => node.x + NODE_W));
	// Room on the right for letter lines that bow out of the last column.
	return { nodes, columns, width: right + PAD + COLUMN_GAP, height: bottom + PAD };
}

export interface FlowLine {
	from: string;
	to: string;
	count: number;
}

/**
 * The letter lines the picture draws: at most `limit`, the busiest pairs first (the order they arrive
 * in), and only between sessions that are on the map. `hidden` is how many were left out.
 */
export function pickFlows<T extends FlowLine>(
	flows: T[],
	onMap: ReadonlySet<string>,
	limit: number,
): { drawn: T[]; hidden: number } {
	const known = flows.filter((flow) => onMap.has(flow.from) && onMap.has(flow.to));
	return { drawn: known.slice(0, limit), hidden: Math.max(0, known.length - limit) };
}

/**
 * The path of a letter line between two nodes, and where its count goes. Between columns it leaves
 * the side of the sender that faces the receiver; within a column it bows out to the right, past the
 * sessions standing between the two. A pair that writes both ways gets two lines, one a little above
 * the other, so the arrows do not cover each other.
 */
export function flowPath(
	from: MapNode,
	to: MapNode,
	nodes: MapNode[],
): { d: string; labelX: number; labelY: number } {
	const lift = from.id < to.id ? -6 : 6;
	const y1 = from.y + NODE_H / 2 + lift;
	const y2 = to.y + NODE_H / 2 + lift;
	if (Math.abs(from.x - to.x) < NODE_W) {
		const x1 = from.x + NODE_W;
		const x2 = to.x + NODE_W;
		const [low, high] = [Math.min(from.y, to.y), Math.max(from.y, to.y)];
		const edge = Math.max(
			x1,
			x2,
			...nodes
				.filter((node) => node.y > low && node.y < high && node.x < Math.max(x1, x2))
				.map((node) => node.x + NODE_W),
		);
		const out = edge + 14 + Math.min(16, Math.abs(y2 - y1) / 12);
		return {
			d: `M${x1} ${y1} C${out} ${y1} ${out} ${y2} ${x2} ${y2}`,
			labelX: (Math.max(x1, x2) + 3 * out) / 4,
			labelY: (y1 + y2) / 2,
		};
	}
	const rightward = to.x > from.x;
	const x1 = rightward ? from.x + NODE_W : from.x;
	const x2 = rightward ? to.x : to.x + NODE_W;
	const mid = (x1 + x2) / 2;
	return {
		d: `M${x1} ${y1} C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`,
		labelX: mid,
		labelY: (y1 + y2) / 2,
	};
}

/** The line from a session down to one it opened: down from under its left end, then across. */
export function openedPath(parent: MapNode, child: MapNode): string {
	const x = parent.x + 10;
	const y = child.y + NODE_H / 2;
	return `M${x} ${parent.y + NODE_H} V${y} H${child.x}`;
}
