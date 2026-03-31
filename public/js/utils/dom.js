export const $ = (sel) => document.querySelector(sel);
export const $$ = (sel) => Array.from(document.querySelectorAll(sel));

export const selectElements = (selectors) => {
    const dom = {};
    for (const [key, sel] of Object.entries(selectors)) {
        dom[key] = $(sel);
    }
    return dom;
};
