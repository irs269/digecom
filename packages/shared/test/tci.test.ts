import { describe, expect, it } from 'vitest';
import { isoWeekOf, isoWeekRange, parseCsv, prepareImport, roundRobin } from '../src/tci';

describe('semaines ISO', () => {
  it('semaine du 2 au 8 novembre 2026 = 2026-W45', () => {
    expect(isoWeekOf('2026-11-02')).toBe('2026-W45');
    expect(isoWeekOf('2026-11-08')).toBe('2026-W45');
    expect(isoWeekOf('2026-11-09')).toBe('2026-W46');
    expect(isoWeekRange('2026-W45')).toEqual({ start: '2026-11-02', end: '2026-11-08' });
  });
  it('semaine à cheval sur deux années', () => {
    expect(isoWeekOf('2027-01-01')).toBe('2026-W53');
    expect(isoWeekRange('2026-W01').start).toBe('2025-12-29');
  });
});

describe('import de contacts', () => {
  it('CSV avec en-tête, point-virgule et guillemets', () => {
    expect(
      parseCsv(
        'nom;téléphone;note\r\n"Mariam Abdou";331 20 45;"veut ""2"""\n\nYoussouf;3428810;\n',
      ),
    ).toEqual([
      ['nom', 'téléphone', 'note'],
      ['Mariam Abdou', '331 20 45', 'veut "2"'],
      ['Youssouf', '3428810', ''],
    ]);
  });

  it('rapport exact : importés, doublons (fichier et campagne), invalides', () => {
    const rows = parseCsv(
      [
        'nom,telephone,note',
        'Mariam Abdou,+269 331 20 45,',
        'Youssouf Mmadi,342 88 10,rappeler le soir',
        'Doublon fichier,3312045,',
        'Déjà en base,+2693376192,',
        'Sans téléphone,,',
        'X,3330000,',
        'Numéro faux,12345,',
      ].join('\n'),
    );
    const report = prepareImport(rows, ['+2693376192']);
    expect(report).toMatchObject({ rows: 7, imported: 2, duplicates: 2, invalid: 3 });
    expect(report.lines.map((l) => [l.line, l.status])).toEqual([
      [2, 'OK'],
      [3, 'OK'],
      [4, 'DUPLICATE'],
      [5, 'DUPLICATE'],
      [6, 'INVALID'],
      [7, 'INVALID'],
      [8, 'INVALID'],
    ]);
    expect(report.lines[1]).toMatchObject({ phone: '+2693428810', note: 'rappeler le soir' });
  });
});

describe('répartition équitable', () => {
  it('round-robin en commençant par les moins chargés', () => {
    const r = roundRobin(
      [1, 2, 3, 4, 5],
      [
        { id: 'a', load: 3 },
        { id: 'b', load: 0 },
      ],
    );
    expect(r.get('b')).toEqual([1, 3, 5]);
    expect(r.get('a')).toEqual([2, 4]);
  });
});
