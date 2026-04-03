import { H } from "fest/lure";
import type { EntityDescriptor } from "@rs-core/utils/Types";
import type { EntityInterface } from "@rs-com/template/EntityInterface";

export type LazyCardOptions = {
    order?: number;
    rootMargin?: string;
};

const cardLabel = (entity: EntityInterface<any, any>): string =>
    entity?.title || entity?.name || entity?.id || "";

export function MakeCardElement<
    E extends EntityInterface<any, any> = EntityInterface<any, any>,
    T extends EntityDescriptor = EntityDescriptor,
>(entityItem: E, entityDesc: T, _options?: LazyCardOptions) {
    return H`<article
        class="entity-card"
        data-entity-type=${entityDesc?.type ?? ""}
        data-entity-id=${entityItem?.id ?? ""}
    >
        <header class="entity-card__header">${cardLabel(entityItem)}</header>
    </article>` as HTMLElement;
}

export function MakeLazyCardElement<
    E extends EntityInterface<any, any> = EntityInterface<any, any>,
    T extends EntityDescriptor = EntityDescriptor,
>(entityItem: E, entityDesc: T, options: LazyCardOptions = {}) {
    const rootMargin = options.rootMargin ?? "200px";
    const host = H`<div
        class="entity-card entity-card--lazy"
        data-entity-id=${entityItem?.id ?? ""}
        aria-busy="true"
    ></div>` as HTMLElement;

    const observer = new IntersectionObserver(
        (entries) => {
            for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                observer.disconnect();
                const card = MakeCardElement(entityItem, entityDesc, options);
                card.style.order = host.style.order;
                host.replaceWith(card);
            }
        },
        { rootMargin },
    );
    observer.observe(host);
    return host;
}
