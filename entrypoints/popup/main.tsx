import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';
import App from '../../src/App';
import { DesignSystemShowcase } from '../../src/components/DesignSystemShowcase';

const params = new URLSearchParams(window.location.search);
const showPrototype =
    import.meta.env.MODE === 'test' && params.has('popup-prototype');

const showDesignSystem =
    import.meta.env.MODE === 'test' && params.has('design-system-showcase');

if (showPrototype) {
    document.documentElement.setAttribute('data-screen', 'prototype');
    document.documentElement.setAttribute(
        'data-theme',
        params.get('theme') === 'light' ? 'light' : 'dark'
    );
    void import('../../src/components/prototype/PopupPrototype').then(
        ({ PopupPrototype }) => {
            createRoot(document.getElementById('root')!).render(
                <StrictMode>
                    <PopupPrototype />
                </StrictMode>
            );
        }
    );
} else {
    if (showDesignSystem) {
        document.documentElement.setAttribute('data-screen', 'showcase');
    }

    const Popup = showDesignSystem ? DesignSystemShowcase : App;

    createRoot(document.getElementById('root')!).render(
        <StrictMode>
            <Popup />
        </StrictMode>
    );
}
