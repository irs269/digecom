import { redact } from './audit.service';

describe('redact', () => {
  it('masque les champs sensibles, y compris imbriqués', () => {
    expect(
      redact({
        fullName: 'Ali',
        password: 'x',
        passwordHash: 'y',
        nested: { refreshToken: 'z', ok: 1 },
        list: [{ secret: 's' }],
      }),
    ).toEqual({
      fullName: 'Ali',
      password: '[masqué]',
      passwordHash: '[masqué]',
      nested: { refreshToken: '[masqué]', ok: 1 },
      list: [{ secret: '[masqué]' }],
    });
  });

  it('laisse passer les valeurs simples', () => {
    expect(redact('texte')).toBe('texte');
    expect(redact(null)).toBeNull();
  });
});
