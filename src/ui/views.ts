import { Failure } from '../core/errors.ts';
import { checklistView, logViewer, presentView } from './screen.ts';
import type {
	CoreViews,
	LazyView,
	NamedViewSpec,
	Present,
	PropsOf,
	Views,
} from './screen.ts';

const CORE_VIEWS: CoreViews = { checklistView, logViewer };

/** The `present` over cli-core's own views and a program's `views`. */
export function presenter<V extends Views>(
	views?: V,
): Present<CoreViews & V> {
	type Registry = CoreViews & V;

	const registry: Partial<Record<string, unknown>> = {
		...CORE_VIEWS,
		...views,
	};
	return async <K extends keyof Registry & string, T>({
		view: name,
		...spec
	}: NamedViewSpec<Registry, K, T>): Promise<T | undefined> => {
		// The registry's type ties each name to its view; the record
		// holding them at run time cannot.
		const view = registry[name] as
			| LazyView<PropsOf<Registry[K]>>
			| undefined;
		if (view === undefined)
			throw new Failure(`no view is registered as ${name}`);
		return presentView({ ...spec, view });
	};
}
