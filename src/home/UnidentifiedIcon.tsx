// Marks a card whose scenes have no performer linked in Stash.
//
// Deliberately not the verified tick in another colour: this is the
// absence of an identity, not a lesser grade of one. A dashed outline
// reads as a slot waiting to be filled, which is exactly the state, and
// it stays distinct from the pink (favourite) and blue (in library)
// ticks the other cards use.
export function UnidentifiedIcon() {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
        >
            <circle
                cx="12"
                cy="12"
                r="9"
                strokeDasharray="3 3"
                strokeWidth="1.75"
            />
            <path d="M12 16v.01" />
            <path d="M9.5 9.5a2.5 2.5 0 1 1 3.2 2.4c-.5.16-.7.5-.7 1.1" />
        </svg>
    );
}
