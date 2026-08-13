// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { BingeScene } from "../api/queries";
import { PerformerRow } from "./PerformerRow";

// PerformerRow used to return null on an empty performer list from above
// its useMemo. That is a conditional hook: a card that renders once with
// no performers and then gets them (the feed fills a scene's performers in
// a later paint) goes from zero hooks to one and React tears the tree down
// with "rendered more hooks than during the previous render". The first
// test here is that exact sequence, so the early return can never drift
// back above the hooks.

vi.mock("../performer/PerformerProfileContext", () => ({
    usePerformerProfile: () => ({ openProfile: vi.fn() }),
}));
vi.mock("./PerformerSheet", () => ({
    PerformerSheet: () => null,
}));

type Performers = BingeScene["performers"];
const people = (...names: string[]): Performers =>
    names.map((n, i) => ({
        id: String(i + 1),
        name: n,
        favorite: false,
    })) as unknown as Performers;

afterEach(cleanup);

describe("PerformerRow", () => {
    it("survives performers arriving after the first paint", () => {
        const { rerender } = render(<PerformerRow performers={people()} />);
        expect(screen.queryByText(/Ada/)).toBeNull();

        // The re-render that used to crash.
        expect(() =>
            rerender(<PerformerRow performers={people("Ada")} />),
        ).not.toThrow();
        expect(screen.getByText(/Ada/)).toBeTruthy();
    });

    it("survives performers going away again", () => {
        const { rerender } = render(
            <PerformerRow performers={people("Ada")} />,
        );
        expect(() =>
            rerender(<PerformerRow performers={people()} />),
        ).not.toThrow();
        expect(screen.queryByText(/Ada/)).toBeNull();
    });

    it("renders nothing at all for an empty list", () => {
        const { container } = render(<PerformerRow performers={people()} />);
        expect(container.firstChild).toBeNull();
    });

    it("names a single performer", () => {
        render(<PerformerRow performers={people("Ada")} />);
        expect(screen.getByText(/Ada/)).toBeTruthy();
    });

    it("names two performers together", () => {
        render(<PerformerRow performers={people("Ada", "Grace")} />);
        expect(screen.getByText(/Ada/)).toBeTruthy();
        expect(screen.getByText(/Grace/)).toBeTruthy();
    });

    it("caps the visible avatars and counts the rest", () => {
        render(
            <PerformerRow performers={people("A", "B", "C", "D", "E", "F")} />,
        );
        // Four bubbles shown, the remaining two summarised as +2.
        expect(screen.getByText("+2")).toBeTruthy();
    });
});
