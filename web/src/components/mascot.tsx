import type { MascotPose } from "../poses.ts";

/**
 * Yew's mascot (blueprint, section 12): a girl with a yew-berry hair ornament, in the poses listed in
 * `poses.ts`. She only decorates: screen readers skip her and she never covers a control.
 */
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
