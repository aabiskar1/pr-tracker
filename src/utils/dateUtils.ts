// Helper function to get age indicator color
export const getAgeColor = (date: string) => {
    const days =
        (Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24);
    if (days < 1) return 'text-green-500';
    if (days < 7) return 'text-yellow-500';
    return 'text-red-500';
};
