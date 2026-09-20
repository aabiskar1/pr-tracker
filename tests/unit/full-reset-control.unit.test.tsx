import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { FullResetControl } from '../../src/components/FullResetControl';

const componentHarness = vi.hoisted(() => ({
    stateIndex: 0,
    refIndex: 0,
    values: [] as unknown[],
    setters: [] as Mock[],
    refs: [] as Array<{ current: unknown }>,
    effects: [] as Array<() => void>,
}));

vi.mock('react', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react')>();
    return {
        ...actual,
        useState: vi.fn((initialValue: unknown) => {
            const index = componentHarness.stateIndex++;
            const setter = vi.fn();
            componentHarness.setters[index] = setter;
            return [
                index in componentHarness.values
                    ? componentHarness.values[index]
                    : initialValue,
                setter,
            ];
        }),
        useRef: vi.fn((initialValue: unknown) => {
            const index = componentHarness.refIndex++;
            componentHarness.refs[index] ??= { current: initialValue };
            return componentHarness.refs[index];
        }),
        useEffect: vi.fn((effect: () => void) => {
            componentHarness.effects.push(effect);
        }),
    };
});

type TestElement = {
    props: Record<string, unknown> & { children?: ReactNode };
};

const elements = (node: ReactNode): TestElement[] => {
    if (node === null || node === undefined || typeof node === 'boolean') {
        return [];
    }
    if (Array.isArray(node)) return node.flatMap(elements);
    if (typeof node !== 'object' || !('props' in node)) return [];
    const element = node as TestElement;
    return [element, ...elements(element.props.children)];
};

const text = (node: ReactNode): string => {
    if (typeof node === 'string') return node;
    if (Array.isArray(node)) return node.map(text).join('');
    if (node && typeof node === 'object' && 'props' in node) {
        return text((node as TestElement).props.children);
    }
    return '';
};

const renderControl = (
    onConfirm: () => Promise<boolean>,
    stateValues: Record<number, unknown> = {}
) => {
    componentHarness.stateIndex = 0;
    componentHarness.refIndex = 0;
    componentHarness.values = [];
    componentHarness.setters = [];
    componentHarness.effects = [];
    for (const [index, value] of Object.entries(stateValues)) {
        componentHarness.values[Number(index)] = value;
    }
    return FullResetControl({ onConfirm }) as ReactNode;
};

const call = <Result,>(handler: unknown, ...args: unknown[]): Result =>
    (handler as (...callArgs: unknown[]) => Result)(...args);

const findButton = (tree: ReactNode, label: string) => {
    const matches = elements(tree).filter(
        (element) => element.props.type === 'button' && text(element) === label
    );
    return matches[matches.length - 1];
};

describe('FullResetControl', () => {
    beforeEach(() => {
        componentHarness.refs = [];
        vi.clearAllMocks();
    });

    it('opens the confirmation dialog without performing a reset', () => {
        const onConfirm = vi.fn(async () => true);
        const tree = renderControl(onConfirm);

        call(findButton(tree, 'Full Reset')?.props.onClick);

        expect(componentHarness.setters[0]).toHaveBeenCalledWith(true);
        expect(onConfirm).not.toHaveBeenCalled();
    });

    it('focuses Cancel and closes safely on Cancel or Escape', () => {
        const onConfirm = vi.fn(async () => true);
        const triggerFocus = vi.fn();
        const cancelFocus = vi.fn();
        componentHarness.refs = [
            { current: { focus: triggerFocus } },
            { current: { focus: cancelFocus } },
            { current: { focus: vi.fn() } },
            { current: false },
        ];
        const tree = renderControl(onConfirm, { 0: true });

        componentHarness.effects[0]();
        expect(cancelFocus).toHaveBeenCalledOnce();
        call(findButton(tree, 'Cancel')?.props.onClick);
        expect(componentHarness.setters[0]).toHaveBeenCalledWith(false);
        expect(triggerFocus).toHaveBeenCalledOnce();
        expect(onConfirm).not.toHaveBeenCalled();

        const dialog = elements(tree).find(
            (element) => element.props.role === 'dialog'
        );
        const preventDefault = vi.fn();
        call(dialog?.props.onKeyDown, { key: 'Escape', preventDefault });
        expect(preventDefault).toHaveBeenCalledOnce();
        expect(componentHarness.setters[0]).toHaveBeenCalledTimes(2);
        expect(onConfirm).not.toHaveBeenCalled();
    });

    it('submits once, waits for acknowledgement, and then closes', async () => {
        let acknowledge!: (result: boolean) => void;
        const onConfirm = vi.fn(
            () => new Promise<boolean>((resolve) => (acknowledge = resolve))
        );
        const tree = renderControl(onConfirm, { 0: true });
        const confirm = findButton(tree, 'Full Reset');

        const firstSubmission = call<Promise<void>>(confirm?.props.onClick);
        const duplicateSubmission = call<Promise<void>>(confirm?.props.onClick);

        expect(onConfirm).toHaveBeenCalledOnce();
        expect(componentHarness.setters[1]).toHaveBeenCalledWith(true);
        expect(componentHarness.setters[0]).not.toHaveBeenCalledWith(false);

        acknowledge(true);
        await Promise.all([firstSubmission, duplicateSubmission]);

        expect(componentHarness.setters[0]).toHaveBeenCalledWith(false);
        expect(componentHarness.setters[1]).toHaveBeenLastCalledWith(false);
    });

    it('keeps the dialog open and displays a safe error when reset fails', async () => {
        const onConfirm = vi.fn(async () => false);
        const tree = renderControl(onConfirm, { 0: true });

        await call<Promise<void>>(
            findButton(tree, 'Full Reset')?.props.onClick
        );

        expect(componentHarness.setters[0]).not.toHaveBeenCalledWith(false);
        expect(componentHarness.setters[2]).toHaveBeenLastCalledWith(
            'Full Reset could not be completed. Please try again.'
        );

        const failedTree = renderControl(onConfirm, {
            0: true,
            2: 'Full Reset could not be completed. Please try again.',
        });
        const alert = elements(failedTree).find(
            (element) => element.props.role === 'alert'
        );
        expect(text(alert as unknown as ReactNode)).toBe(
            'Full Reset could not be completed. Please try again.'
        );
    });
});
