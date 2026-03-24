import { countLines, cropFirstLetter, MAKE_LABEL, makeObjectEntries, wrapBySpan, sanitizeDocSnippet, truncateDocSnippet, type CardRenderOptions } from "@rs-core/text";
export type { CardRenderOptions } from "@rs-core/text";
import { H, M, bindBeh } from "fest/lure";
import { propRef } from "fest/object";
import { formatAsTime, formatAsDate, parseDateCorrectly } from "@rs-core/time";
import type { EntityDescriptor } from "@rs-core/utils/Types";
import type { EntityInterface } from "@rs-com/template/EntityInterface";
import { iconsPerAction, labelsPerAction } from "@rs-core/utils/Actions";
import { GeoState, isNearby } from "@rs-com/service/misc/GeoService";
import { TimeState, isNow, registerEventForNotification } from "@rs-com/service/misc/TimeService";
import { findEntities } from "@rs-com/service/misc/EntityRegistry";
import { writeText } from "@rs-core/modules/Clipboard";
import { scheduleFrame } from "@rs-core/utils/Runtime";

//
import { marked } from "marked";
import markedKatex from "marked-katex-extension";
import { makeEvents } from "@rs-frontend/shells/faint/editors/EntityEdit";
import { makePropertyDesc, formatPhoneElement, formatEmailElement, renderAddress } from "./Elements";
marked.use(markedKatex({
    throwOnError: false,
    nonStandard: true
}) as any);

type CardEventHandlers = ReturnType<typeof makeEvents>;
type HydratedCardElement = HTMLElement & {
    $updateInfo?: (entity?: EntityInterface<any, any>) => void;
    $setVisible?: (visible: boolean) => void;
    $isLoaded?: boolean;
};

const SWIPE_TRIGGER_PX = 72;
const SWIPE_MAX_DISTANCE = 144;
const SWIPE_BREAKPOINT = 720;
const SWIPE_MIN_DISTANCE = 8;

// Priority properties to display prominently
const PRIORITY_PROPS = new Set([
    'status', 'location', 'phone', 'email', 'code', 'price',
    'begin_time', 'end_time', 'members', 'contacts', 'usableFor', 'usableIn'
]);

// Properties to exclude from display
const EXCLUDED_PROPS = new Set([
    'begin_time', 'end_time', 'status', 'variant'
]);

// Status badge colors
const STATUS_VARIANTS: Record<string, string> = {
    'pending': 'orange',
    'in-progress': 'blue',
    'active': 'blue',
    'completed': 'green',
    'done': 'green',
    'cancelled': 'red',
    'failed': 'red',
    'expired': 'purple'
};

//
const getStatusVariant = (status: string | undefined): string => {
    if (!status) return 'default';
    const normalized = status.toLowerCase().replace(/\s+/g, '-');
    return STATUS_VARIANTS[normalized] || 'default';
};

//
const formatPromoCode = (code: string | undefined) => {
    if (!code?.trim()) return null;
    return H`<div class="card-promo-code" data-action="copy-code">
        <ui-icon icon="ticket"></ui-icon>
        <span class="code-value">${code.trim()}</span>
        <ui-icon icon="copy" class="copy-hint"></ui-icon>
    </div>`;
};

//
const formatPrice = (price: number | string | undefined, currency?: string) => {
    if (price == null || price === '') return null;
    const formatted = typeof price === 'number'
        ? new Intl.NumberFormat(navigator.language, {
            style: currency ? 'currency' : 'decimal',
            currency: currency || undefined,
            minimumFractionDigits: 0,
            maximumFractionDigits: 2
        }).format(price)
        : String(price);
    return H`<div class="card-price">
        <ui-icon icon="currency-circle-dollar"></ui-icon>
        <span>${formatted}</span>
    </div>`;
};

//
const formatStatus = (status: string | undefined) => {
    if (!status?.trim()) return null;
    const variant = getStatusVariant(status);
    return H`<div class="card-status-badge" data-variant="${variant}">
        <span>${status}</span>
    </div>`;
};

//
const formatTags = (tags: string[] | undefined) => {
    if (!tags?.length) return null;
    return H`<div class="card-tags">
        ${tags.slice(0, 5).map(tag => H`<span class="card-tag">${tag}</span>`)}
        ${tags.length > 5 ? H`<span class="card-tag-more">+${tags.length - 5}</span>` : null}
    </div>`;
};

//
const formatLinks = (links: string[] | any[] | undefined) => {
    if (!links?.length) return null;
    return H`<div class="card-links-list">
        ${links.slice(0, 3).map(link => {
            const url = typeof link === 'string' ? link : link?.url || link?.href;
            const label = typeof link === 'string' ? new URL(url).hostname : (link?.label || link?.title || new URL(url).hostname);
            return H`<a class="card-link" href="${url}" target="_blank" rel="noopener">
                <ui-icon icon="link"></ui-icon>
                <span>${label}</span>
            </a>`;
        })}
    </div>`;
};

//
const formatContactInfo = (entity: EntityInterface<any, any>) => {
    const phones = entity?.properties?.phone || entity?.properties?.phones;
    const emails = entity?.properties?.email || entity?.properties?.emails;
    const contacts = entity?.properties?.contacts;

    const elements: any[] = [];

    if (phones) {
        const phoneList = Array.isArray(phones) ? phones : [phones];
        phoneList.slice(0, 2).forEach(phone => {
            const el = formatPhoneElement(phone);
            if (el) elements.push(el);
        });
    }

    if (emails) {
        const emailList = Array.isArray(emails) ? emails : [emails];
        emailList.slice(0, 2).forEach(email => {
            const el = formatEmailElement(email);
            if (el) elements.push(el);
        });
    }

    if (contacts && typeof contacts === 'string') {
        elements.push(H`<span class="card-contact-text">${contacts}</span>`);
    }

    return elements.length ? H`<div class="card-contacts">${elements}</div>` : null;
};

//
const formatLocationInfo = (location: any) => {
    if (!location) return null;

    const address = location?.address;
    const coordinate = location?.coordinate;
    const name = location?.name || location?.title;

    const parts: any[] = [];

    if (name) {
        parts.push(H`<span class="location-name">${name}</span>`);
    }

    if (address) {
        const addressEl = renderAddress(address);
        if (addressEl) {
            parts.push(H`<span class="location-address">${addressEl}</span>`);
        }
    }

    if (coordinate?.latitude && coordinate?.longitude) {
        parts.push(H`<a class="location-coords" href="geo:${coordinate.latitude},${coordinate.longitude}" target="_blank">
            <ui-icon icon="map-pin"></ui-icon>
        </a>`);
    }

    return parts.length ? H`<div class="card-location">
        <ui-icon icon="map-pin"></ui-icon>
        ${parts}
    </div>` : null;
};

//
const formatMembers = (members: string[] | any[] | undefined) => {
    if (!members?.length) return null;
    return H`<div class="card-members">
        <ui-icon icon="users"></ui-icon>
        <span class="members-count">${members.length} member${members.length > 1 ? 's' : ''}</span>
    </div>`;
};

//
const formatUsability = (usableFor: string[] | undefined, usableIn: string[] | undefined) => {
    const items = [...(usableFor || []), ...(usableIn || [])];
    if (!items.length) return null;

    return H`<div class="card-usability">
        <ui-icon icon="storefront"></ui-icon>
        <span>${items.slice(0, 3).join(', ')}${items.length > 3 ? ` +${items.length - 3}` : ''}</span>
    </div>`;
};

//
const formatAvailability = (availability: any) => {
    if (!availability) return null;

    const parts: string[] = [];
    if (availability.count) parts.push(`${availability.count} left`);
    if (availability.days?.length) parts.push(availability.days.slice(0, 3).join(', '));
    if (availability.time?.length) parts.push(availability.time[0]);

    return parts.length ? H`<div class="card-availability">
        <ui-icon icon="clock"></ui-icon>
        <span>${parts.join(' • ')}</span>
    </div>` : null;
};

//
const formatQuickInfo = (entity: EntityInterface<any, any>, _entityDesc?: EntityDescriptor) => {
    const elements: any[] = [];
    const props = entity?.properties || {};

    // Price (for items/services)
    if (props.price != null) {
        const priceEl = formatPrice(props.price, props.currency);
        if (priceEl) elements.push(priceEl);
    }

    // Location
    if (props.location) {
        const locationEl = formatLocationInfo(props.location);
        if (locationEl) elements.push(locationEl);
    }

    // Members (for tasks/events)
    if (props.members?.length) {
        const membersEl = formatMembers(props.members);
        if (membersEl) elements.push(membersEl);
    }

    // Usability (for bonus/promo)
    if (props.usableFor?.length || props.usableIn?.length) {
        const usabilityEl = formatUsability(props.usableFor, props.usableIn);
        if (usabilityEl) elements.push(usabilityEl);
    }

    // Availability (for bonus)
    if (props.availability) {
        const availabilityEl = formatAvailability(props.availability);
        if (availabilityEl) elements.push(availabilityEl);
    }

    // Contact info
    const contactEl = formatContactInfo(entity);
    if (contactEl) elements.push(contactEl);

    return elements.length ? H`<div class="card-quick-info">${elements}</div>` : null;
};

//
const formatExpandedProperties = (entity: EntityInterface<any, any>) => {
    const props = entity?.properties || {};
    const filteredProps = Object.entries(props).filter(([key]) =>
        !EXCLUDED_PROPS.has(key) && !PRIORITY_PROPS.has(key)
    );

    if (!filteredProps.length) return null;

    return H`<ul class="card-properties">${M(
        makeObjectEntries(Object.fromEntries(filteredProps)),
        (frag: any) => makePropertyDesc(MAKE_LABEL(frag?.[0]), frag?.[1], frag?.[0])
    )}</ul>`;
};

//
const createCardSkeleton = (order?: number | null): HydratedCardElement => {
    const skeleton = H`<div class="card-wrap card-skeleton" data-order=${order ?? ""}>
        <div class="card">
            <div class="card-avatar skeleton-pulse"></div>
            <div class="card-props">
                <div class="skeleton-line skeleton-title"></div>
                <div class="skeleton-line skeleton-subtitle"></div>
            </div>
            <div class="card-quick-info">
                <div class="skeleton-line skeleton-short"></div>
            </div>
        </div>
    </div>` as HydratedCardElement;

    skeleton.$isLoaded = false;
    return skeleton;
};

//
export const MakeCardElement = <
    E extends EntityInterface<any, any> = EntityInterface<any, any>,
    T extends EntityDescriptor = EntityDescriptor
>(
    entityItem: E,
    entityDesc: T,
    options: CardRenderOptions = {}
): HydratedCardElement | null => {
    if (!entityItem) return null;

    //
    const begin_time = formatAsTime(entityItem?.properties?.begin_time) || "";
    const end_time = formatAsTime(entityItem?.properties?.end_time) || "";
    const variant = entityItem?.variant || entityItem?.properties?.variant || "default";

    // Process description
    let description = entityItem?.description || "";
    let descriptionPreview = "";

    if (typeof description === "string") {
        descriptionPreview = truncateDocSnippet(sanitizeDocSnippet(description), 120);
        if (countLines(description) <= 1) {
            description = description?.split?.(",") ?? [];
        }
    } else if (Array.isArray(description)) {
        descriptionPreview = truncateDocSnippet(sanitizeDocSnippet(description.join(' ')), 120);
    }

    // Time range element with enhanced styling
    let timeRangeElement = null;
    if (begin_time || end_time) {
        const beginDate = parseDateCorrectly(entityItem?.properties?.begin_time);
        const showDate = beginDate && !isToday(beginDate);

        timeRangeElement = H`<div class="card-time">
            <ui-icon icon="clock"></ui-icon>
            ${showDate ? H`<span class="time-date">${formatAsDate(entityItem?.properties?.begin_time)}</span>` : null}
            <span class="time-range">${begin_time}${end_time ? ` – ${end_time}` : ''}</span>
        </div>`;
    }

    //
    const events = makeEvents(entityItem, entityDesc);
    const editIcon = iconsPerAction.get("edit") ?? "pencil";
    const deleteIcon = iconsPerAction.get("delete") ?? "trash";
    const editLabel = labelsPerAction.get("edit")?.(entityDesc) ?? "Edit";
    const deleteLabel = labelsPerAction.get("delete")?.(entityDesc) ?? "Remove";

    const handleCardToggle = (ev: Event) => {
        const target = ev.currentTarget as HTMLElement | null;
        if (!target) return;
        if (target.getAttribute("data-swipe-lock") === "true") {
            ev.preventDefault();
            ev.stopPropagation();
            return;
        }
        target.toggleAttribute("data-open");
    };

    const handleCodeCopy = (ev: Event) => {
        const target = ev.currentTarget as HTMLElement;
        const code = target.querySelector('.code-value')?.textContent?.trim();
        if (code) {
            writeText(code);
            target.setAttribute('data-copied', 'true');
            setTimeout(() => target.removeAttribute('data-copied'), 1500);
        }
        ev.stopPropagation();
    };

    // Status badge
    const statusEl = formatStatus(entityItem?.properties.status);

    // Quick info section
    const quickInfoEl = formatQuickInfo(entityItem, entityDesc);

    // Promo code element (for actions area)
    const promoCodeEl = formatPromoCode(entityItem?.properties?.code);

    // Tags
    const tagsEl = formatTags(entityItem?.tags);

    // Links
    const linksEl = formatLinks(entityItem?.properties?.links);

    // Image preview
    const imageEl = entityItem?.image ? H`<div class="card-image-preview">
        <img src="${propRef(entityItem, "image")}" alt="" loading="lazy" decoding="async" />
    </div>` : null;

    // Entity type icon
    const typeIcon = getTypeIcon(entityDesc.type);

    const card = H`<div class="card-wrap" data-order=${(options?.order ? propRef(options, "order") : "") || ""} data-type="${propRef(entityItem, "type")}">
        <div class="card-swipe-preview">
            <div class="card-swipe-action is-edit">
                <ui-icon icon=${editIcon}></ui-icon>
                <span>${editLabel}</span>
            </div>
            <div class="card-swipe-action is-remove">
                <ui-icon icon=${deleteIcon}></ui-icon>
                <span>${deleteLabel}</span>
            </div>
        </div>
        <div data-id=${entityItem?.id || entityItem?.name} data-variant="${variant}" data-type="${propRef(entityItem, "type")}" class="card" on:click=${handleCardToggle}>
            <div class="card-header">
                <div class="card-avatar" data-type="${propRef(entityItem, "type")}">
                    <div class="avatar-inner">${entityItem?.icon ? H`<ui-icon icon=${propRef(entityItem, "icon")}></ui-icon>` : cropFirstLetter(entityItem?.title ?? entityDesc.label ?? "C")}</div>
                </div>
                <div class="card-title-row">
                    <h3 class="card-title">${entityItem?.title || entityItem?.name || entityDesc.label}</h3>
                </div>
                <div class="card-props">

                </div>
                ${timeRangeElement}
                ${quickInfoEl}
                ${descriptionPreview ? H`<p class="card-description-preview">${descriptionPreview}</p>` : null}
            </div>

            ${tagsEl}

            <div class="card-actions">
                ${propRef(entityItem, "kind") ? H`<span class="card-kind">${propRef(entityItem, "kind")}</span>` : null}
                ${statusEl}
                ${typeIcon ? H`<span class="card-type-badge">
                    <ui-icon icon="${typeIcon}"></ui-icon>
                </span>` : null}
                ${promoCodeEl}
                ${events.doEdit ? H`<button class="action" on:click=${events.doEdit}><ui-icon icon="pencil"></ui-icon><span>Edit</span></button>` : null}
                ${events.doDelete ? H`<button class="action" on:click=${events.doDelete}><ui-icon icon="trash"></ui-icon><span>Delete</span></button>` : null}
            </div>

            <div class="card-expanded">
                ${imageEl}

                ${description && (Array.isArray(description) ? description.length : description.trim()) ? H`<div class="card-description">
                    <span class="card-label">Description</span>
                    <div class="card-description-content">
                        ${H(marked.parse((Array.isArray(description) ? description?.map?.((frag) => wrapBySpan(frag?.trim?.()))?.join("<br>") : wrapBySpan(description?.trim?.()))?.trim?.() || ""))}
                    </div>
                </div>` : null}

                ${linksEl ? H`<div class="card-section">
                    <span class="card-label">Links</span>
                    ${linksEl}
                </div>` : null}

                <div class="card-content">
                    <span class="card-label">Properties</span>
                    ${formatExpandedProperties(entityItem)}
                </div>
            </div>
        </div>
    </div>` as HydratedCardElement;

    const cardInner = card.querySelector(".card") as HTMLElement;

    // Bind promo code copy handler
    const promoCodeDomEl = card.querySelector('.card-promo-code');
    if (promoCodeDomEl) {
        promoCodeDomEl.addEventListener('click', handleCodeCopy);
    }

    //
    if (entityItem?.properties?.location?.coordinate) {
        const { latitude, longitude } = entityItem.properties.location.coordinate;
        bindBeh(cardInner, GeoState, () => {
            const nearby = isNearby(latitude, longitude);
            cardInner.classList.toggle("is-nearby", nearby);
        });
    } else if (entityItem?.properties?.usableIn || entityItem?.properties?.usableFor) {
        bindBeh(cardInner, GeoState, () => {
            let nearby = false;
            const checkList = [
                ...(entityItem.properties?.usableIn || []),
                ...(entityItem.properties?.usableFor || [])
            ];

            for (const pattern of checkList) {
                if (typeof pattern === 'string') {
                    const matches = findEntities(pattern);
                    for (const entity of matches) {
                        if (entity.properties?.location?.coordinate) {
                            const { latitude, longitude } = entity.properties.location.coordinate;
                            if (isNearby(latitude, longitude)) {
                                nearby = true;
                                break;
                            }
                        }
                    }
                }
                if (nearby) break;
            }

            cardInner.classList.toggle("is-nearby", nearby);
        });
    }

    //
    if (entityItem?.properties?.begin_time) {
        bindBeh(cardInner, TimeState, () => {
            const active = isNow(entityItem.properties.begin_time, entityItem.properties.end_time);
            cardInner.classList.toggle("is-now", active);
        });

        if (entityItem.id && entityItem.title && (entityDesc.type === 'task' || entityDesc.type === 'event')) {
            registerEventForNotification(String(entityItem.id), entityItem.title, entityItem.properties.begin_time);
        }
    }

    const orderValue = options?.order;
    if (typeof orderValue === "number" && Number.isFinite(orderValue)) {
        try {
            card.style.order = Math.trunc(orderValue).toString();
            card.setAttribute("data-order", card.style.order);
            card.style.setProperty("--card-order", card.style.order);
        } catch (e) {
            console.warn("Failed to set card order", e);
        }
    }

    cardInner.setAttribute("data-swipe-lock", "false");
    setupSwipeGestures(cardInner, events, card);

    //
    const updateCardInfo = ($entityItem: E = entityItem) => {
        const titleEl = card.querySelector('.card-title');
        if (titleEl && $entityItem.title) titleEl.textContent = $entityItem.title;

        const kindEl = card.querySelector('.card-kind');
        if (kindEl && $entityItem.kind) kindEl.textContent = $entityItem.kind;

        const timeRangeEl = card.querySelector('.card-time .time-range');
        if (timeRangeEl && $entityItem.properties?.begin_time) {
            const bt = formatAsTime($entityItem.properties?.begin_time);
            const et = formatAsTime($entityItem.properties?.end_time);
            timeRangeEl.textContent = `${bt}${et ? ` – ${et}` : ''}`;
        }

        const imageEl = card.querySelector<HTMLImageElement>('.card-image-preview img');
        if (imageEl && $entityItem.image) {
            imageEl.src = $entityItem.image;
        }
    };

    //
    card.$updateInfo = updateCardInfo as HydratedCardElement["$updateInfo"];
    card.$isLoaded = true;
    return card;
};

//
const getTypeIcon = (type: string | undefined): string => {
    const icons: Record<string, string> = {
        'task': 'check-square',
        'event': 'calendar',
        'person': 'user',
        'place': 'map-pin',
        'service': 'briefcase',
        'item': 'package',
        'factor': 'activity',
        'bonus': 'gift',
        'skill': 'star'
    };
    return icons[type || ''] || 'file';
};

//
const isToday = (date: Date): boolean => {
    const today = new Date();
    return date.getDate() === today.getDate() &&
        date.getMonth() === today.getMonth() &&
        date.getFullYear() === today.getFullYear();
};

type SwipeAction = "edit" | "remove";

const shouldHandlePointer = (ev: PointerEvent) => ev?.pointerType === "touch" || ev?.pointerType === "pen";

const isSwipeEnvironment = () => {
    if (typeof window === "undefined") return false;
    const hasCoarsePointer = globalThis?.matchMedia?.("(pointer: coarse)")?.matches ?? false;
    const hoverNone = globalThis?.matchMedia?.("(hover: none)")?.matches ?? false;
    const viewportInlineSize =
        globalThis?.visualViewport?.width ??
        globalThis?.innerWidth ??
        (typeof document !== "undefined" ? document.documentElement?.clientWidth : undefined) ??
        SWIPE_BREAKPOINT;
    const narrowViewport = viewportInlineSize <= SWIPE_BREAKPOINT;
    const hasTouchPoints = typeof navigator !== "undefined" ? (navigator.maxTouchPoints ?? 0) > 0 : false;
    return (hasCoarsePointer || hoverNone || hasTouchPoints) && narrowViewport;
};

const setupSwipeGestures = (card: HTMLElement, events: CardEventHandlers, wrapper: HTMLElement) => {
    if (!isSwipeEnvironment() || card.getAttribute("data-swipe-handlers-applied") === "true") {
        return;
    }

    card.setAttribute("data-swipe-handlers-applied", "true");

    let pointerId: number | null = null;
    let startX = 0;
    let startY = 0;
    let currentOffset = 0;
    let isSwiping = false;

    const applySwipeVisuals = (offset: number) => {
        card.style.setProperty("--card-swipe-offset", `${offset}px`);
        const progress = Math.min(Math.abs(offset) / SWIPE_TRIGGER_PX, 1);
        wrapper.style.setProperty("--card-swipe-progress", progress.toString());

        if (progress >= 1) {
            card.setAttribute("data-swipe-ready", "true");
        } else {
            card.removeAttribute("data-swipe-ready");
        }
    };

    const resetSwipeState = () => {
        if (pointerId !== null) {
            card.releasePointerCapture?.(pointerId);
            pointerId = null;
        }
        currentOffset = 0;
        isSwiping = false;
        card.setAttribute("data-swipe-lock", "false");
        card.removeAttribute("data-swiping");
        card.removeAttribute("data-swipe-ready");
        card.removeAttribute("data-swipe-action");
        card.style.setProperty("--card-swipe-offset", "0px");
        wrapper.style.setProperty("--card-swipe-progress", "0");
    };

    const showSuccess = (action: SwipeAction) => {
        card.setAttribute("data-swipe-success", action);
        globalThis?.setTimeout(() => {
            if (card.getAttribute("data-swipe-success") === action) {
                card.removeAttribute("data-swipe-success");
            }
        }, 360);
    };

    const triggerSwipeAction = (action: SwipeAction) => {
        const handler = action === "edit" ? events?.doEdit : events?.doDelete;
        if (typeof handler === "function") {
            try {
                const syntheticEvent = new CustomEvent("card-swipe", {
                    detail: {
                        action,
                        direction: action === "edit" ? "right" : "left",
                        source: "mobile-swipe"
                    }
                });
                handler(syntheticEvent);
            } catch (error) {
                console.error("Card swipe action failed", error);
            }
        }
        showSuccess(action);
    };

    const handlePointerDown = (ev: PointerEvent) => {
        if (!shouldHandlePointer(ev)) return;
        pointerId = ev.pointerId;
        startX = ev.clientX;
        startY = ev.clientY;
        currentOffset = 0;
        isSwiping = false;
        card.setPointerCapture?.(pointerId);
    };

    const handlePointerMove = (ev: PointerEvent) => {
        if (pointerId === null || ev.pointerId !== pointerId) return;

        const deltaX = ev.clientX - startX;
        const deltaY = ev.clientY - startY;

        if (!isSwiping) {
            if (Math.abs(deltaY) > Math.abs(deltaX) && Math.abs(deltaY) > SWIPE_MIN_DISTANCE) {
                resetSwipeState();
                return;
            }
            if (Math.abs(deltaX) >= SWIPE_MIN_DISTANCE && Math.abs(deltaX) > Math.abs(deltaY)) {
                isSwiping = true;
                card.setAttribute("data-swiping", "true");
                card.setAttribute("data-swipe-lock", "true");
            } else {
                return;
            }
        }

        ev.preventDefault();
        const constrained = Math.max(Math.min(deltaX, SWIPE_MAX_DISTANCE), -SWIPE_MAX_DISTANCE);
        currentOffset = constrained;
        const action: SwipeAction = constrained >= 0 ? "edit" : "remove";
        card.setAttribute("data-swipe-action", action);
        applySwipeVisuals(constrained);
    };

    const finalizeSwipe = () => {
        if (pointerId === null) return;
        const shouldTrigger = isSwiping && Math.abs(currentOffset) >= SWIPE_TRIGGER_PX;
        if (shouldTrigger) {
            const action: SwipeAction = currentOffset > 0 ? "edit" : "remove";
            triggerSwipeAction(action);
        }
        resetSwipeState();
    };

    card.addEventListener("pointerdown", handlePointerDown, { passive: true });
    card.addEventListener("pointermove", handlePointerMove, { passive: false });
    card.addEventListener("pointerup", finalizeSwipe, { passive: true });
    card.addEventListener("pointercancel", finalizeSwipe, { passive: true });
};

// =============================================================================
// Progressive/Lazy Loading Support
// =============================================================================

export interface LazyCardOptions extends CardRenderOptions {
    onVisible?: () => void;
    rootMargin?: string;
    threshold?: number;
}

const cardObserver = new WeakMap<HTMLElement, IntersectionObserver>();
const pendingCards = new WeakMap<HTMLElement, { entity: any; desc: any; options: LazyCardOptions }>();

//
export const createLazyCardPlaceholder = <
    E extends EntityInterface<any, any> = EntityInterface<any, any>,
    T extends EntityDescriptor = EntityDescriptor
>(
    entityItem: E,
    entityDesc: T,
    options: LazyCardOptions = {}
): HydratedCardElement => {
    const placeholder = createCardSkeleton(options.order);

    // Store entity data for lazy hydration
    pendingCards.set(placeholder, { entity: entityItem, desc: entityDesc, options });

    // Set up intersection observer for lazy loading
    const observer = new IntersectionObserver(
        (entries) => {
            for (const entry of entries) {
                if (entry.isIntersecting) {
                    const target = entry.target as HydratedCardElement;
                    hydrateLazyCard(target);
                    observer.unobserve(target);
                    cardObserver.delete(target);
                }
            }
        },
        {
            rootMargin: options.rootMargin || '200px 0px',
            threshold: options.threshold || 0
        }
    );

    observer.observe(placeholder);
    cardObserver.set(placeholder, observer);

    return placeholder;
};

//
const hydrateLazyCard = (placeholder: HydratedCardElement) => {
    const data = pendingCards.get(placeholder);
    if (!data || placeholder.$isLoaded) return;

    const { entity, desc, options } = data;

    // Create the real card
    const realCard = MakeCardElement(entity, desc, options);
    if (!realCard) {
        placeholder.remove();
        return;
    }

    // Animate the transition
    realCard.classList.add('card-hydrating');

    // Replace placeholder with real card
    placeholder.parentNode?.replaceChild(realCard, placeholder);

    // Trigger enter animation
    scheduleFrame(() => {
        realCard.classList.remove('card-hydrating');
        realCard.classList.add('card-hydrated');
    });

    // Cleanup
    pendingCards.delete(placeholder);
    options.onVisible?.();
};

//
export const MakeLazyCardElement = <
    E extends EntityInterface<any, any> = EntityInterface<any, any>,
    T extends EntityDescriptor = EntityDescriptor
>(
    entityItem: E,
    entityDesc: T,
    options: LazyCardOptions = {}
): HydratedCardElement | null => {
    if (!entityItem) return null;

    // For items that should load immediately (first batch), use regular cards
    const order = options.order ?? 0;
    if (typeof order === 'number' && order < 10) {
        return MakeCardElement(entityItem, entityDesc, options);
    }

    // For items further down, use lazy loading
    return createLazyCardPlaceholder(entityItem, entityDesc, options);
};
