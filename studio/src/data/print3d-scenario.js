// 3D print farm — the engineering reference scenario.
// MaScLib-domains generated instances, 3 sizes (45 / 90 / 180 jobs).

export const PRINT3D_SCENARIO = {
  id: 'print3d',
  name: { en: '3D print farm', pt: 'Fazenda de impressão 3D' },
  visual: {
    image: 'assets/scenarios/print3d.webp',
    alt: { en: 'Isometric diorama of a 3D print farm', pt: 'Diorama isométrico de uma fazenda de impressão 3D' },
  },
  shortDescription: {
    en: 'A farm of printers takes custom part orders. Each order has a quoted deadline; accepting late work costs reputation.',
    pt: 'Uma fazenda de impressoras recebe pedidos de peças. Cada pedido tem prazo cotado; aceitar atraso custa reputação.',
  },
  description: {
    en: 'Orders arrive with a processing time (print duration), a weight (how valuable the client is) and a due date. The machine runs one job at a time; switching between part families (materials/colors) needs a purge-and-load setup. You may reject an order at a published penalty. The goal: pick the order sequence — and which orders to decline — that minimizes weighted tardiness plus rejection costs.',
    pt: 'Pedidos chegam com tempo de processamento (duração de impressão), peso (valor do cliente) e prazo. A máquina roda um job por vez; trocar de família (material/cor) exige setup de purga. Você pode rejeitar um pedido pagando multa publicada. O objetivo: escolher a sequência — e o que recusar — minimizando atraso ponderado mais custo de rejeição.',
  },
  decisions: [
    { en: 'Which orders to accept or reject', pt: 'Quais pedidos aceitar ou rejeitar' },
    { en: 'In which order to print the accepted ones', pt: 'Em que ordem imprimir os aceitos' },
  ],
  vocabulary: {
    job: { en: 'part order', pt: 'pedido de peça' },
    machine: { en: 'printer', pt: 'impressora' },
    setup: { en: 'purge / material change', pt: 'purga / troca de material' },
    family: { en: 'material + color', pt: 'material + cor' },
    rejection: { en: 'declined order fee', pt: 'multa por pedido recusado' },
  },
  objective: {
    en: 'Minimize weighted tardiness + rejection penalties',
    pt: 'Minimizar atraso ponderado + multas de rejeição',
  },
  simplifications: {
    en: 'One printer stands for the farm; setups depend only on material family; all orders are known at the start of the planning horizon.',
    pt: 'Uma impressora representa a fazenda; setups dependem só da família de material; todos os pedidos são conhecidos no início do horizonte.',
  },
  disclosure: {
    en: 'Instances are synthetic (MaScLib-domains generator), calibrated so rejection is a real option at these horizon sizes.',
    pt: 'Instâncias sintéticas (gerador MaScLib-domains), calibradas para que a rejeição seja opção real nestes tamanhos de horizonte.',
  },
  instances: [
    { id: '3DPRINT_FARM_45', size: 'S', jobs: 45, horizon: '1 week', families: 6 },
    { id: '3DPRINT_FARM_90', size: 'M', jobs: 90, horizon: '2 weeks', families: 8 },
    { id: '3DPRINT_FARM_180', size: 'L', jobs: 180, horizon: '1 month', families: 10 },
  ],
};
