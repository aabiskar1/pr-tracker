import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';
import App from '../../src/App';
import { DesignSystemShowcase } from '../../src/components/DesignSystemShowcase';
import { initializeTheme } from '../../src/services/themeManager';

const showDesignSystem =
    import.meta.env.MODE === 'test' &&
    new URLSearchParams(window.location.search).has('design-system-showcase');

if (showDesignSystem) {
    document.documentElement.setAttribute('data-screen', 'showcase');
}

const Popup = showDesignSystem ? DesignSystemShowcase : App;

async function mountPopup() {
    await initializeTheme();
    createRoot(document.getElementById('root')!).render(
        <StrictMode>
            <Popup />
        </StrictMode>
    );
}

void mountPopup();
