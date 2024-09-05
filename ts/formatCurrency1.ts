export function formatCurrency(amount: number) {
    return new Intl.NumberFormat('en-US', {
        style: "currency", currency: 'USD',
    }).format(amount)
}
// input: 300
// output: $300.00