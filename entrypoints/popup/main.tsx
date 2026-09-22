import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';
import App from '../../src/App';
import { DesignSystemShowcase } from '../../src/components/DesignSystemShowcase';

const showDesignSystem =
    import.meta.env.MODE === 'test' &&
    new URLSearchParams(window.location.search).has('design-system-showcase');

if (showDesignSystem) {
    document.documentElement.setAttribute('data-screen', 'showcase');
}

const Popup = showDesignSystem ? DesignSystemShowcase : App;

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <Popup />
    </StrictMode>
);
