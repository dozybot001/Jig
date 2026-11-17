/**
 * Yew's mascot (blueprint, section 12): a girl with a yew-berry hair ornament, in ten poses. Each pose
 * is on the same 373 by 400 canvas, so changing the pose in a place never makes it jump. She only
 * decorates: screen readers skip her and she never covers a control.
 */
export type MascotPose =
	| "greeting"
	| "thinking"
	| "happy"
	| "sleepy"
	| "writing"
	| "shush"
	| "sorry"
	| "waking"
	| "gift"
	| "lost";

const WIDTH = 373;
const HEIGHT = 400;

export function Mascot({
	pose,
	height,
	className,
}: {
	pose: MascotPose;
	height: number;
	className?: string;
}) {
	return (
		<img
			className={`mascot${className ? ` ${className}` : ""}`}
			src={`/mascot/${pose}.webp`}
			width={Math.round((height * WIDTH) / HEIGHT)}
			height={height}
			alt=""
			draggable={false}
		/>
	);
}
