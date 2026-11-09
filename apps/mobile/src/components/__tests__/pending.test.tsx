import { act, render, screen } from '@testing-library/react-native';

globalThis.fetch = jest.fn(async () => {
  throw new TypeError('Network request failed');
}) as unknown as typeof fetch;

import { submitAction } from '@/lib/offline';
import { PendingBanner } from '../pending';

test('le bandeau signale les actions en attente de réseau', async () => {
  await render(<PendingBanner />);
  expect(screen.queryByTestId('pending-banner')).toBeNull();
  await act(async () => {
    await submitAction('/me/orders/o1/markSold', {}, 'Client a pris');
  });
  expect(screen.getByText(/1 action en attente d’envoi/)).toBeTruthy();
});
