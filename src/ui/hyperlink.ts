const OSC = '\u001b]';

const BEL = '\u0007';

/**
 * `label` as an OSC 8 hyperlink to `url`, written plain: tmux keeps a
 * plain link on the cells and forwards it to its terminal on every
 * redraw, where one wrapped in its passthrough reaches that terminal
 * apart from the label and marks no cell.
 */
export const hyperlink = (label: string, url: string): string =>
	`${OSC}8;;${url}${BEL}${label}${OSC}8;;${BEL}`;
