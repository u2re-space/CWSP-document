import { H, M, openDirectory } from "fest/lure";
import { $trigger, isObservable, observe, numberRef, iterated, affected } from "fest/object";
import { computeTimelineOrderInGeneral, computeTimelineOrderInsideOfDay, createDayDescriptor, formatAsDate, getComparableTimeValue, insideOfDay, parseDateCorrectly } from "@rs-core/time";
import { MakeCardElement, MakeLazyCardElement, type LazyCardOptions } from "./Cards";
import type { ChapterDescriptor, EntityDescriptor } from "@rs-core/utils/Types";
import type { EntityInterface } from "@rs-com/template/EntityInterface";
import { scheduleFrame } from "@rs-core/utils/Runtime";
import { cleanToDay, GET_OR_CACHE_BY_NAME, mergeByExists, PUSH_ONCE, REMOVE_IF_HAS } from "@rs-core/utils/Utils";
import { bindDropToDir } from "@rs-core/storage/FileOps";
import { registerEntity, unregisterEntity } from "@rs-com/service/misc/EntityRegistry";

// =============================================================================
// Progressive Loading Configuration
// =============================================================================

const INITIAL_BATCH_SIZE = 10;
const LAZY_LOAD_ROOT_MARGIN = '400px 0px';
const LOAD_DEBOUNCE_MS = 50;
const BATCH_PROCESS_SIZE = 5; // Process files in batches for better performance

// =============================================================================
// OPFS Loading Utilities
// =============================================================================

// Batch processor for parallel file loading with concurrency limit
const processBatch = async <T, R>(
    items: T[],
    processor: (item: T, index: number) => Promise<R>,
    batchSize: number = BATCH_PROCESS_SIZE
): Promise<R[]> => {
    const results: R[] = [];

    for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);
        const batchResults = await Promise.all(
            batch.map((item, idx) => processor(item, i + idx).catch(() => null as unknown as R))
        );
        results.push(...batchResults);

        // Yield to main thread between batches
        if (i + batchSize < items.length) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }

    return results;
};

// Cache for file content to avoid re-reading unchanged files
const fileContentCache = new Map<string, { content: any; lastModified: number }>();

const getCachedOrLoad = async <T>(
    name: string,
    fileHandle: any,
    forceRefresh = false
): Promise<T | null> => {
    try {
        const file = await fileHandle?.getFile?.();
        if (!file) return null;

        const lastModified = file.lastModified || 0;
        const cached = fileContentCache.get(name);

        // Return cached if not stale
        if (!forceRefresh && cached && cached.lastModified >= lastModified) {
            return cached.content as T;
        }

        // Load and cache
        const content = await GET_OR_CACHE_BY_NAME(name, Promise.resolve(file));
        if (content) {
            fileContentCache.set(name, { content, lastModified });
        }

        return content as T;
    } catch (e) {
        console.warn(`Failed to load file: ${name}`, e);
        return null;
    }
};

// Cleanup old cache entries
const pruneCache = (maxEntries = 500) => {
    if (fileContentCache.size > maxEntries) {
        const entries = Array.from(fileContentCache.entries());
        entries
            .sort((a, b) => a[1].lastModified - b[1].lastModified)
            .slice(0, entries.length - maxEntries)
            .forEach(([key]) => fileContentCache.delete(key));
    }
};

// =============================================================================
// Items Loader with Optimized OPFS Access
// =============================================================================

const MakeItemsLoaderForTabPage = <
    T extends EntityDescriptor = EntityDescriptor,
    E extends EntityInterface<any, any> = EntityInterface<any, any>,
    C extends ChapterDescriptor = ChapterDescriptor
>(
    sourceRef: T,
    chapterRef: C,
    filtered: (item: E, desc: C) => boolean
) => {
    const dataRef: E[] = observe([]) as E[];

    let loadLocked = false;
    let loaderDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    let dHandle: any = null;
    let loadGeneration = 0; // Track load generations to avoid stale updates

    const dispose = () => {
        if (loaderDebounceTimer) {
            clearTimeout(loaderDebounceTimer);
            loaderDebounceTimer = null;
        }
        dHandle?.dispose?.();
        dHandle = null;
        loadGeneration++;
    };

    const isValidJsonFile = (name: string): boolean => {
        const trimmed = name?.trim?.() || '';
        return trimmed.endsWith('.json') && !trimmed.endsWith('.crswap');
    };

    const processFileEntry = async (
        entry: [string, any],
        _index: number,
        currentGeneration: number
    ): Promise<E | null> => {
        // Abort if generation changed (newer load started)
        if (currentGeneration !== loadGeneration) return null;

        const [name, fileHandle] = entry;
        if (!isValidJsonFile(name)) return null;

        try {
            const obj = await getCachedOrLoad<any>(name, fileHandle);
            if (!obj || currentGeneration !== loadGeneration) return null;

            let processedObj = obj as E;
            if (typeof obj === 'object' && obj != null) {
                processedObj = (isObservable(obj) ? obj : observe(obj)) as E;
                (processedObj as any).__name = name;
                (processedObj as any).__path = `${sourceRef.DIR}${name}`;
            }

            // Check filter
            if (filtered(processedObj, chapterRef as C)) {
                return processedObj;
            }

            return null;
        } catch (e) {
            console.warn(`Error loading item: ${name}`, e);
            return null;
        }
    };

    const load = async () => {
        if (loadLocked) return { dataRef, load, dispose };
        loadLocked = true;

        const currentGeneration = ++loadGeneration;

        try {
            dHandle = openDirectory(null, sourceRef.DIR, { create: true });
            await dHandle;

            const loader = async () => {
                if (currentGeneration !== loadGeneration) return;

                const map = dHandle.getMap();
                const handleMap = Array.from(map.entries()) as [string, any][];

                // Process in batches for better performance
                const refs = await processBatch(
                    handleMap,
                    (entry, index) => processFileEntry(entry, index, currentGeneration),
                    BATCH_PROCESS_SIZE
                );

                // Abort if generation changed
                if (currentGeneration !== loadGeneration) return;

                // Filter out nulls and merge
                const validRefs = refs.filter((ref): ref is E => ref !== null);
                mergeByExists(dataRef as any, validRefs as any);

                // Remove items that no longer exist in the directory or don't match filter
                const currentNames = new Set(handleMap.map(([name]) => name));
                for (let i = dataRef.length - 1; i >= 0; i--) {
                    const item = dataRef[i];
                    if (item) {
                        const itemName = (item as any).__name || (item as any).name;
                        const existsInDir = currentNames.has(itemName);
                        const matchesFilter = existsInDir &&
                            isValidJsonFile(itemName) &&
                            filtered(item, chapterRef as C);

                        if (!matchesFilter) {
                            dataRef.splice(i, 1);
                        }
                    }
                }

                // Periodically prune cache
                pruneCache();
            };

            const debouncedLoader = () => {
                if (loaderDebounceTimer) {
                    clearTimeout(loaderDebounceTimer);
                }
                loaderDebounceTimer = setTimeout(() => {
                    loader().catch(console.warn.bind(console));
                }, LOAD_DEBOUNCE_MS);
            };

            // Initial load
            await loader().catch(console.warn.bind(console));

            // Subscribe to changes
            affected(dHandle?.getMap?.() ?? [], debouncedLoader);
        } catch (e) {
            console.warn('Error in items loader:', e);
        } finally {
            loadLocked = false;
        }

        return { dataRef, load, dispose };
    };

    return { dataRef, load, dispose };
}

//
export const CollectItemsForTabPage = <
    T extends EntityDescriptor = EntityDescriptor,
    E extends EntityInterface<any, any> = EntityInterface<any, any>,
    C extends ChapterDescriptor = ChapterDescriptor
>(
    sourceRef: T,
    chapterRef: C,
    filtered: (item: E, desc: C) => boolean,
    ItemRenderer: (item: E, desc: T, options?: LazyCardOptions) => any
) => {
    //
    const loader = MakeItemsLoaderForTabPage(sourceRef, chapterRef, filtered);

    //
    let firstTimeLoaded = false;
    const firstTimeLoad = () => {
        if (firstTimeLoaded) return; firstTimeLoaded = true;
        loader.load().catch(console.warn.bind(console));
    }

    //
    const minTimestampRef = numberRef(0);
    const maxTimestampRef = numberRef(0);

    //
    affected([loader.dataRef, Symbol.iterator], () => {
        minTimestampRef.value = Math.min(...loader.dataRef.map((item) => Math.max(0, getComparableTimeValue(item?.properties?.begin_time ?? 0))));
        maxTimestampRef.value = Math.max(...loader.dataRef.map((item) => Math.max(0, getComparableTimeValue(item?.properties?.begin_time ?? 0))));
    })

    //
    let renderedCount = 0;
    const makeItemEl = (item) => {
        const order = computeTimelineOrderInsideOfDay(item, chapterRef) || 0;
        const isInitialBatch = renderedCount < INITIAL_BATCH_SIZE;
        renderedCount++;

        // Use lazy loading for items beyond initial batch
        const options: LazyCardOptions = {
            order,
            rootMargin: LAZY_LOAD_ROOT_MARGIN
        };

        const itemEl = isInitialBatch
            ? ItemRenderer(item as E, sourceRef as T, options)
            : MakeLazyCardElement(item as E, sourceRef as T, options);

        if (itemEl) {
            itemEl.style.order = String(order);
        }
        return itemEl;
    };

    //
    const daysRef = observe([]) as any[];
    const kindsRef = observe([]) as any[];
    const subgroups = observe([]) as any[];

    //
    iterated(loader.dataRef, (newItem, _index, oldItem) => {
        const item = newItem ?? oldItem;
        const forAddOrDelete = newItem != null;

        // Register/Unregister globally
        if (forAddOrDelete && newItem) {
            registerEntity(newItem);
        } else if (!forAddOrDelete && oldItem) {
            unregisterEntity(oldItem);
        }

        //
        const day = cleanToDay(item), kind = item?.kind;
        if (day && daysRef?.find((d) => d?.begin_time == day?.begin_time)) { PUSH_ONCE(daysRef, day); };
        if (kind && kindsRef?.find((d) => d?.kind == kind)) { PUSH_ONCE(kindsRef, kind); };

        //
        if (!forAddOrDelete) {
            subgroups.forEach((d) => {
                REMOVE_IF_HAS(d.items, item);
            });
        }

        //
        if (item?.type == "task" || item?.type == "event") {
            const dayOf = createDayDescriptor(parseDateCorrectly(item?.properties?.begin_time));
            if (dayOf && insideOfDay(item, dayOf)) {
                let foundSubgroup = subgroups.find((d) => d?.day == dayOf?.begin_time)
                if (!foundSubgroup) {
                    PUSH_ONCE(subgroups, foundSubgroup ||= {
                        items: observe([]),
                        day: dayOf?.begin_time,
                        kind: item?.kind
                    });
                }

                //
                if (forAddOrDelete) { PUSH_ONCE(foundSubgroup.items, item); } else { REMOVE_IF_HAS(foundSubgroup.items, item); }
                if (foundSubgroup?.items?.length <= 0) { REMOVE_IF_HAS(subgroups, foundSubgroup); }
            }
        } else
            if (item?.kind) {
                let foundSubgroup = subgroups.find((d) => d?.kind == item?.kind)
                if (!foundSubgroup) {
                    PUSH_ONCE(subgroups, foundSubgroup ||= {
                        items: observe([]),
                        kind: item?.kind
                    });
                }

                //
                if (forAddOrDelete) { PUSH_ONCE(foundSubgroup.items, item); } else { REMOVE_IF_HAS(foundSubgroup.items, item); }
                if (foundSubgroup?.items?.length <= 0) { REMOVE_IF_HAS(subgroups, foundSubgroup); }
            }
    });

    //
    document.addEventListener("rs-fs-changed", () => {
        loader.dataRef?.[$trigger]?.();
        subgroups.forEach((d) => d.items?.[$trigger]?.());
    });

    //
    const subgroupsEl = M(subgroups, (subgroup) => {
        const itm = M(subgroup?.items ?? [], makeItemEl);
        const cnt = H`<div class="subgroup-items">${itm}</div>`;
        const els = H`<div class="subgroup">
            <div class="subgroup-header">${subgroup?.day ? formatAsDate(subgroup?.day) : subgroup?.kind}</div>
            ${cnt}
        </div>`
        itm.boundParent = cnt;

        // set order with small forming delay
        const we = new WeakRef(els);
        const usb = affected(minTimestampRef, (minVal) => {
            const els = we?.deref?.();
            if (els && subgroup?.day) { els.style.order = (computeTimelineOrderInGeneral(subgroup?.day as any, minVal) || 0); };
            if (!els) { usb?.(); }
        });
        return els;
    });

    //
    const subgroupBody = H`<div class="viewer-tab-content-body" data-load-state="pending">${subgroupsEl}</div>` as HTMLElement;
    const root = H`<div class="viewer-tab-content tab-content" data-name="${sourceRef?.type}">
        <div class="viewer-tab-content-header">${sourceRef?.label || sourceRef?.type}</div>
        ${subgroupBody}
    </div>`;
    root.addEventListener('dir-dropped', () => firstTimeLoad?.());
    (root as any).reloadList = firstTimeLoad;
    subgroupsEl.boundParent = subgroupBody;

    // Track loading state and update data-load-state attribute
    const updateLoadState = () => {
        const hasContent = subgroups.length > 0;
        const state = firstTimeLoaded ? (hasContent ? 'loaded' : 'empty') : 'pending';
        subgroupBody.dataset.loadState = state;
    };

    // Update load state when subgroups change
    affected([subgroups, Symbol.iterator], updateLoadState);

    // Wrap firstTimeLoad to update state after load completes
    const originalFirstTimeLoad = firstTimeLoad;
    const wrappedFirstTimeLoad = () => {
        subgroupBody.dataset.loadState = 'loading';
        originalFirstTimeLoad();
        // Give loader time to populate, then update state
        setTimeout(updateLoadState, LOAD_DEBOUNCE_MS + 100);
    };
    const firstTimeLoadWithState = () => {
        if (firstTimeLoaded) return;
        wrappedFirstTimeLoad();
    };

    //
    if (sourceRef.DIR) {
        bindDropToDir(root as any, sourceRef.DIR);
    }

    //
    (root as any).dispose = () => {
        loader.dispose();
        loader.dataRef?.splice?.(0, loader.dataRef?.length ?? 0);
        loader.dataRef.length = 0; // TODO: fix in reactive library
    };

    //
    root.addEventListener('contentvisibilityautostatechange', () => { firstTimeLoadWithState?.(); });
    root.addEventListener('visibilitychange', () => { firstTimeLoadWithState?.(); });
    root.addEventListener('focusin', () => { firstTimeLoadWithState?.(); });

    // after append and appear in pages, try to first signal
    scheduleFrame(() => {
        if (root?.checkVisibility?.()) {
            firstTimeLoadWithState?.();
        }
    });

    //
    return root;
}

//
export const MakeItemBy = <E extends EntityInterface<any, any> = EntityInterface<any, any>, T extends EntityDescriptor = EntityDescriptor>(
    entityItem: E,
    entityDesc: T,
    ItemMaker: (entityItem: E, entityDesc: T, options?: LazyCardOptions) => any = MakeCardElement,
    options: LazyCardOptions = {}
) => {
    if (!entityItem) return null;
    return ItemMaker(entityItem, entityDesc, options);
}
