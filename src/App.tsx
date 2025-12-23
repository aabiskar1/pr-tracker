import { useEffect } from 'react';
import './App.css';
import { useAuth } from './hooks/useAuth';
import { useTheme } from './hooks/useTheme';
import { usePullRequests } from './hooks/usePullRequests';
import { Login } from './components/Login';
import { PasswordSetup } from './components/PasswordSetup';
import { PasswordEntry } from './components/PasswordEntry';
import { Dashboard } from './components/Dashboard';

function App() {
    const {
        token,
        setToken,
        password,
        setPassword,
        confirmPassword,
        setConfirmPassword,
        rememberPassword,
        setRememberPassword,
        authState,
        isLoading: isAuthLoading,
        tokenError,
        passwordError,
        handleTokenSubmit,
        handlePasswordSetup,
        handlePasswordEntry,
        handleSignOut,
        handleReset,
    } = useAuth();

    const { theme, handleThemeChange } = useTheme();

    const {
        filteredPRs,
        isLoading: isPRLoading,
        filterState,
        sortOption,
        customQuery,
        customQueryInput,
        setCustomQueryInput,
        isCustomQueryActive,
        notificationsEnabled,
        globalError,
        setGlobalError,
        handleFilterChange,
        handleSortChange,
        handleResetFilters,
        handleSearch,
        handleSaveCustomQuery,
        handleResetCustomQuery,
        handleToggleNotifications,
        refreshPullRequests,
    } = usePullRequests(password, authState);

    const isLoading = isAuthLoading || (authState === 'authenticated' && isPRLoading);

    // Update a data attribute on <html> so CSS can size the popup per-screen (helps Firefox)
    useEffect(() => {
        const screen = isLoading
            ? 'loading'
            : authState === 'authenticated'
                ? 'prlist'
                : 'auth';
        document.documentElement.setAttribute('data-screen', screen);
    }, [isLoading, authState]);

    if (isLoading) {
        return (
            <div className="flex items-center justify-center min-h-[400px] p-4">
                <div className="flex flex-col items-center space-y-4">
                    <div className="w-12 h-12 rounded-full border-4 border-primary border-t-transparent animate-spin"></div>
                    <p className="text-gray-600 dark:text-gray-300">
                        Loading PR Tracker...
                    </p>
                </div>
            </div>
        );
    }

    if (authState === 'login-needed') {
        return (
            <Login
                token={token}
                setToken={setToken}
                handleTokenSubmit={handleTokenSubmit}
                tokenError={tokenError}
            />
        );
    }

    if (authState === 'password-setup') {
        return (
            <PasswordSetup
                password={password}
                setPassword={setPassword}
                confirmPassword={confirmPassword}
                setConfirmPassword={setConfirmPassword}
                rememberPassword={rememberPassword}
                setRememberPassword={setRememberPassword}
                handlePasswordSetup={handlePasswordSetup}
                passwordError={passwordError}
                onBack={() => {
                    setToken('');
                    // We need to reset auth state in useAuth, but for now we can just reload or handle it there
                    // Ideally useAuth should expose a reset function or setAuthState
                    window.location.reload();
                }}
            />
        );
    }

    if (authState === 'password-entry') {
        return (
            <PasswordEntry
                password={password}
                setPassword={setPassword}
                rememberPassword={rememberPassword}
                setRememberPassword={setRememberPassword}
                handlePasswordEntry={handlePasswordEntry}
                passwordError={passwordError}
                handleReset={handleReset}
            />
        );
    }

    return (
        <Dashboard
            globalError={globalError}
            setGlobalError={setGlobalError}
            theme={theme}
            handleThemeChange={handleThemeChange}
            notificationsEnabled={notificationsEnabled}
            handleToggleNotifications={handleToggleNotifications}
            isLoading={isPRLoading}
            refreshPullRequests={refreshPullRequests}
            handleSignOut={handleSignOut}
            filterState={filterState}
            handleFilterChange={handleFilterChange}
            handleSortChange={handleSortChange}
            handleResetFilters={handleResetFilters}
            sortOption={sortOption}
            customQueryInput={customQueryInput}
            setCustomQueryInput={setCustomQueryInput}
            handleSaveCustomQuery={handleSaveCustomQuery}
            handleResetCustomQuery={handleResetCustomQuery}
            isCustomQueryActive={isCustomQueryActive}
            customQuery={customQuery}
            handleSearch={handleSearch}
            filteredPRs={filteredPRs}
        />
    );
}

export default App;
