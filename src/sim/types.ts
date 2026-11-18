/**
 * The world file and the loader's options (docs/sim.md, section 2). Plain types with no imports, so
 * a controller can use them as they are.
 */

export type Thinking = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface WorldModel {
	provider: string;
	model: string;
	thinking?: Thinking;
}

export type WorldTranscriptItem =
	| { role: "user"; text: string; at?: string }
	| {
			role: "assistant";
			text?: string;
			calls?: { id: string; tool: string; args: Record<string, unknown> }[];
			at?: string;
	  }
	| {
			role: "toolResult";
			callId: string;
			tool: string;
			text: string;
			isError?: boolean;
			at?: string;
	  }
	| { role: "compaction"; summary: string; at?: string };

export interface WorldSession {
	name: string;
	kind: "standing" | "task";
	team?: string | null;
	role?: string;
	workspace?: string | null;
	permissionMode?: "auto" | "manual" | "skip";
	receive?: "accept" | "hold" | "refuse";
	canOrganize?: boolean;
	canPostCards?: boolean;
	model: "under-test" | WorldModel;
	/** The session that opened this task, by name. */
	openedBy?: string | null;
	status?:
		| { state: "idle" }
		| { state: "error"; error: string; since?: string }
		| { state: "archived" };
	transcript?: WorldTranscriptItem[];
}

export interface WorldLetter {
	/** What scoring calls this letter; `replyTo` names another letter by it. */
	key?: string;
	/** A session's name, "@person" or "@cli". */
	from: string;
	to: string;
	kind: "notice" | "request" | "decision" | "report";
	summary: string;
	body?: string;
	status: "queued" | "held" | "delivered" | "done" | "refused" | "dropped";
	at?: string;
	replyTo?: string;
	/** The number of the decision a decision letter relays. */
	decision?: number;
}

export interface WorldCard {
	number: number;
	/** The session that put the card in the approval center, by name. */
	by?: string | null;
	requestedBy?: string | null;
	title: string;
	context?: string;
	options?: { label: string; detail?: string }[];
	/** An option's label. */
	recommended?: string | null;
	deadline?: string | null;
	sessions?: string[];
	undoable?: boolean;
	reversible?: string;
	after?: string;
	status: "pending" | "decided" | "withdrawn";
	/** The label of the option the person chose; leave it out for an answer that is only a note. */
	choice?: string | null;
	note?: string | null;
	createdAt?: string;
	decidedAt?: string;
	withdrawnReason?: string;
	/** Sessions the decision was already delivered to, by name. */
	deliveredTo?: string[];
}

export interface WorldSchedule {
	name: string;
	cron: string;
	session: string;
	message: string;
	enabled?: boolean;
	permissionMode?: "auto" | "manual" | "skip";
	catchUp?: boolean;
}

export interface World {
	format: "yew-sim-world/1";
	/** When the scenario starts, ISO 8601; the clock starts here when YEW_SIM_DATE is not set. */
	date: string;
	settings?: {
		language?: "system" | "zh" | "en";
		mainSession?: string;
		defaultModel?: WorldModel;
	};
	teams?: { name: string }[];
	workspaces?: { name: string; path: string }[];
	sessions: WorldSession[];
	letters?: WorldLetter[];
	cards?: WorldCard[];
	schedules?: WorldSchedule[];
}

/** A provider of the controller's own: its scripted stand-ins, or a model on this computer. */
export interface SimProvider {
	id: string;
	name: string;
	baseUrl: string;
	keyRequired: boolean;
	models: {
		id: string;
		name?: string;
		contextWindow: number;
		maxTokens: number;
		reasoning?: boolean;
	}[];
}

export interface LoadOptions {
	/** The data folder to load into; it should be new. */
	home: string;
	/** The model for sessions whose model is "under-test". */
	underTest?: WorldModel;
	providers?: SimProvider[];
	/** The global instruction file under test; an empty one when there is none. */
	skill?: string;
}

/** The ids the world got, for scoring: sessions by name, letters by key, cards by number. */
export interface LoadedWorld {
	sessions: Record<string, string>;
	letters: Record<string, string>;
	cards: Record<string, string>;
}
