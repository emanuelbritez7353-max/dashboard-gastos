import { useEffect, useMemo, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "./App.css";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

const STORAGE_GASTOS = "dashboard_gastos";
const STORAGE_RESUMENES = "dashboard_resumenes_pago";

function limpiarFormulario() {
  return {
    id: "",
    descripcion: "",
    categoria: "",
    montoTotal: "",
    cuotas: "",
    cuotaActual: "",
    fechaCompra: "",
    tarjeta: "",
  };
}

function limpiarResumen() {
  return {
    id: "",
    entidad: "",
    tipo: "Tarjeta",
    fechaPago: "",
    totalPagar: "",
    pagoMinimo: "",
  };
}

const gastosIniciales = [];

function cargarStorage(clave, valorInicial) {
  const datos = localStorage.getItem(clave);

  if (!datos) {
    return valorInicial;
  }

  try {
    return JSON.parse(datos);
  } catch {
    return valorInicial;
  }
}

function normalizarGastos(gastos) {
  return gastos.map((gasto) => ({
    ...gasto,
    id: gasto.id || crypto.randomUUID(),
    montoTotal: Number(gasto.montoTotal || 0),
    cuotas: Number(gasto.cuotas || 1),
    cuotaActual: Number(gasto.cuotaActual || 1),
  }));
}

function formatearDinero(valor) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(valor || 0);
}

function sumarMeses(fecha, meses) {
  const nuevaFecha = new Date(fecha);
  nuevaFecha.setMonth(nuevaFecha.getMonth() + meses);
  return nuevaFecha;
}

function formatearMes(fecha) {
  return fecha.toLocaleDateString("es-AR", {
    month: "long",
    year: "numeric",
  });
}

function convertirFecha(fechaTexto) {
  const partes = fechaTexto.split("/");
  const dia = partes[0].padStart(2, "0");
  const mes = partes[1].padStart(2, "0");
  let anio = partes[2];

  if (!anio) {
    anio = new Date().getFullYear().toString();
  }

  if (anio.length === 2) {
    anio = "20" + anio;
  }

  return `${anio}-${mes}-${dia}`;
}

function convertirMonto(montoTexto) {
  return Number(
    String(montoTexto)
      .replace("$", "")
      .replace("ARS", "")
      .replace(/\s/g, "")
      .replace(/\./g, "")
      .replace(",", ".")
  );
}

function extraerTextoOrdenado(contenido) {
  const items = contenido.items
    .filter((item) => item.str && item.str.trim() !== "")
    .map((item) => ({
      texto: item.str,
      x: item.transform[4],
      y: Math.round(item.transform[5]),
    }));

  const lineas = {};

  items.forEach((item) => {
    if (!lineas[item.y]) {
      lineas[item.y] = [];
    }

    lineas[item.y].push(item);
  });

  return Object.keys(lineas)
    .sort((a, b) => Number(b) - Number(a))
    .map((y) =>
      lineas[y]
        .sort((a, b) => a.x - b.x)
        .map((item) => item.texto)
        .join(" ")
    )
    .join("\n");
}

function detectarEntidad(texto, nombrePDF) {
  const combinado = `${nombrePDF} ${texto}`.toLowerCase();

  if (combinado.includes("american express") || combinado.includes("amex")) {
    return "American Express";
  }

  if (combinado.includes("visa")) {
    return "Visa";
  }

  if (combinado.includes("mastercard") || combinado.includes("master card")) {
    return "Mastercard";
  }

  if (combinado.includes("bbva")) {
    return "BBVA";
  }

  if (combinado.includes("santander")) {
    return "Santander";
  }

  if (combinado.includes("galicia")) {
    return "Galicia";
  }

  if (combinado.includes("macro")) {
    return "Banco Macro";
  }

  if (combinado.includes("nacion") || combinado.includes("nación")) {
    return "Banco Nación";
  }

  return nombrePDF || "Resumen PDF";
}

function detectarResumenPago(textoPDF, nombrePDF) {
  const lineas = textoPDF
    .split("\n")
    .map((linea) => linea.trim())
    .filter(Boolean);

  const entidad = detectarEntidad(textoPDF, nombrePDF);

  let fechaPago = "";
  let totalPagar = 0;
  let pagoMinimo = 0;

  function normalizarTexto(texto) {
    return String(texto)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  function obtenerMontos(linea) {
    const encontrados =
      String(linea).match(
        /(?:\$|ARS)?\s*-?\d{1,3}(?:\.\d{3})+(?:,\d{2})?|(?:\$|ARS)?\s*-?\d+,\d{2}/gi
      ) || [];

    return encontrados
      .map((texto) => ({
        texto,
        numero: convertirMonto(texto),
        posicion: String(linea).indexOf(texto),
      }))
      .filter((item) => item.numero > 0);
  }

  function obtenerFechas(linea) {
    return String(linea).match(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g) || [];
  }

  function esLineaDescartableParaResumen(linea) {
    const l = normalizarTexto(linea);

    return (
      l.includes("tasa") ||
      l.includes("nominal") ||
      l.includes("efectiva") ||
      l.includes("limite") ||
      l.includes("disponible") ||
      l.includes("financiacion") ||
      l.includes("en pesos") ||
      l.includes("en dolares") ||
      l.includes("compra") && l.includes("limite")
    );
  }

  function buscarMontoEnMismaLinea(indice) {
    const linea = lineas[indice];

    if (!linea || esLineaDescartableParaResumen(linea)) {
      return 0;
    }

    const montos = obtenerMontos(linea);

    if (montos.length === 0) {
      return 0;
    }

    return montos[montos.length - 1].numero;
  }

  function buscarMontoEnLineasCercanas(indice, cantidadLineas = 4) {
    for (let i = indice + 1; i <= indice + cantidadLineas && i < lineas.length; i++) {
      const linea = lineas[i];

      if (esLineaDescartableParaResumen(linea)) {
        continue;
      }

      const montos = obtenerMontos(linea);

      if (montos.length > 0) {
        return montos[montos.length - 1].numero;
      }
    }

    return 0;
  }

  function buscarMontoDespuesDeTexto(linea, palabras) {
    const lineaNormalizada = normalizarTexto(linea);
    const montos = obtenerMontos(linea);

    if (montos.length === 0) {
      return 0;
    }

    let posicionTexto = -1;

    palabras.forEach((palabra) => {
      const posicion = lineaNormalizada.indexOf(normalizarTexto(palabra));

      if (posicion >= 0 && (posicionTexto === -1 || posicion < posicionTexto)) {
        posicionTexto = posicion;
      }
    });

    if (posicionTexto === -1) {
      return montos[montos.length - 1].numero;
    }

    const montosDespues = montos.filter((monto) => monto.posicion >= posicionTexto);

    if (montosDespues.length > 0) {
      return montosDespues[0].numero;
    }

    return montos[montos.length - 1].numero;
  }

  function buscarFechaCerca(indice, cantidadLineas = 5) {
    for (let i = indice; i <= indice + cantidadLineas && i < lineas.length; i++) {
      const fechas = obtenerFechas(lineas[i]);

      if (fechas.length > 0) {
        return convertirFecha(fechas[fechas.length - 1]);
      }
    }

    return "";
  }

  /*
    PRIMERA PASADA:
    Buscar por líneas. Esto funciona cuando el PDF entrega:
    TOTAL A PAGAR 72.558,37
    PAGO MINIMO 50.630,00
  */
  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];
    const l = normalizarTexto(linea);
    const fechas = obtenerFechas(linea);

    const esTotalAPagar =
      l.includes("total a pagar") ||
      l.includes("total pagar") ||
      l.includes("pago total") ||
      l.includes("saldo total") ||
      l.includes("total del resumen") ||
      l.includes("importe total");

    const esPagoMinimo =
      l.includes("pago minimo") ||
      l.includes("minimo a pagar");

    const esFechaPago =
      l.includes("vencimiento") ||
      l.includes("fecha de pago") ||
      l.includes("fecha pago") ||
      l.includes("pagar hasta") ||
      l.includes("fecha limite");

    if (esFechaPago && !fechaPago) {
      if (fechas.length > 0) {
        fechaPago = convertirFecha(fechas[fechas.length - 1]);
      } else {
        fechaPago = buscarFechaCerca(i, 5);
      }
    }

    if (esTotalAPagar && !totalPagar) {
      totalPagar = buscarMontoEnMismaLinea(i);

      if (!totalPagar) {
        totalPagar = buscarMontoEnLineasCercanas(i, 5);
      }
    }

    if (esPagoMinimo && !pagoMinimo) {
      pagoMinimo = buscarMontoDespuesDeTexto(linea, [
        "pago minimo",
        "minimo a pagar",
      ]);

      if (!pagoMinimo) {
        pagoMinimo = buscarMontoEnLineasCercanas(i, 4);
      }
    }
  }

  /*
    SEGUNDA PASADA:
    Buscar en todo el texto unido.
    Esto ayuda cuando el PDF separa columnas o corta renglones.
  */
  const textoPlano = lineas.join(" ");
  const textoPlanoNormalizado = normalizarTexto(textoPlano);

  if (!totalPagar) {
    const matchTotal = textoPlanoNormalizado.match(
      /total\s+a\s+pagar.{0,80}?(\d{1,3}(?:\.\d{3})+(?:,\d{2})|\d+,\d{2})/
    );

    if (matchTotal && matchTotal[1]) {
      totalPagar = convertirMonto(matchTotal[1]);
    }
  }

  if (!pagoMinimo) {
    const matchMinimo = textoPlanoNormalizado.match(
      /pago\s+minimo.{0,80}?(\d{1,3}(?:\.\d{3})+(?:,\d{2})|\d+,\d{2})/
    );

    if (matchMinimo && matchMinimo[1]) {
      pagoMinimo = convertirMonto(matchMinimo[1]);
    }
  }

  /*
    TERCERA PASADA:
    Caso común de Visa:
    "abonando el pago mínimo de $ 50630,00"
  */
  if (!pagoMinimo) {
    const matchPlanV = textoPlanoNormalizado.match(
      /pago\s+minimo\s+de.{0,40}?(\d{1,3}(?:\.\d{3})+(?:,\d{2})|\d+,\d{2})/
    );

    if (matchPlanV && matchPlanV[1]) {
      pagoMinimo = convertirMonto(matchPlanV[1]);
    }
  }

  /*
    Corrección de seguridad:
    Si el pago mínimo queda mayor al total, está mal detectado.
    En ese caso buscamos otra vez un pago mínimo menor o igual al total.
  */
  if (totalPagar && pagoMinimo && pagoMinimo > totalPagar) {
    let nuevoPagoMinimo = 0;

    for (let i = 0; i < lineas.length; i++) {
      const linea = lineas[i];
      const l = normalizarTexto(linea);

      if (l.includes("pago minimo") || l.includes("minimo a pagar")) {
        const montosValidos = obtenerMontos(linea)
          .map((monto) => monto.numero)
          .filter((monto) => monto > 0 && monto <= totalPagar);

        if (montosValidos.length > 0) {
          nuevoPagoMinimo = montosValidos[0];
          break;
        }
      }
    }

    if (!nuevoPagoMinimo) {
      const matchMinimoValido = textoPlanoNormalizado.match(
        /pago\s+minimo.{0,80}?(\d{1,3}(?:\.\d{3})+(?:,\d{2})|\d+,\d{2})/
      );

      if (matchMinimoValido && matchMinimoValido[1]) {
        const posibleMinimo = convertirMonto(matchMinimoValido[1]);

        if (posibleMinimo > 0 && posibleMinimo <= totalPagar) {
          nuevoPagoMinimo = posibleMinimo;
        }
      }
    }

    pagoMinimo = nuevoPagoMinimo;
  }

  /*
    Corrección especial:
    Si el total no se detectó, pero hay una línea exacta TOTAL A PAGAR,
    buscamos el mayor monto razonable cerca de esa línea.
  */
  if (!totalPagar) {
    for (let i = 0; i < lineas.length; i++) {
      const l = normalizarTexto(lineas[i]);

      if (l.includes("total a pagar")) {
        const candidatos = [];

        for (let j = i; j <= i + 6 && j < lineas.length; j++) {
          if (esLineaDescartableParaResumen(lineas[j])) {
            continue;
          }

          obtenerMontos(lineas[j]).forEach((monto) => {
            if (monto.numero > 0) {
              candidatos.push(monto.numero);
            }
          });
        }

        if (candidatos.length > 0) {
          totalPagar = Math.max(...candidatos);
        }

        break;
      }
    }
  }

  if (!fechaPago) {
    const primeraFecha = textoPDF.match(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/);

    if (primeraFecha) {
      fechaPago = convertirFecha(primeraFecha[0]);
    }
  }

  if (!totalPagar && !pagoMinimo) {
    return null;
  }

  return {
    id: crypto.randomUUID(),
    entidad,
    tipo: "Tarjeta",
    fechaPago,
    totalPagar,
    pagoMinimo,
    origen: "PDF",
  };
}

function detectarGastosDesdeTexto(textoPDF, nombrePDF) {
  const lineas = textoPDF
    .split("\n")
    .map((linea) => linea.trim())
    .filter(Boolean);

  const gastosDetectados = [];
  const entidad = detectarEntidad(textoPDF, nombrePDF);

  lineas.forEach((linea) => {
    const fechaEncontrada = linea.match(/\b(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\b/);

    const montosEncontrados = linea.match(
      /(?:\$|ARS)?\s*-?\d{1,3}(?:\.\d{3})+(?:,\d{2})?|(?:\$|ARS)?\s*-?\d+,\d{2}/gi
    );

    if (!fechaEncontrada || !montosEncontrados) {
      return;
    }

    const lineaLower = linea.toLowerCase();

    if (
      lineaLower.includes("total a pagar") ||
      lineaLower.includes("pago mínimo") ||
      lineaLower.includes("pago minimo") ||
      lineaLower.includes("saldo total") ||
      lineaLower.includes("vencimiento") ||
      lineaLower.includes("límite") ||
      lineaLower.includes("limite")
    ) {
      return;
    }

    const montoTexto = montosEncontrados[montosEncontrados.length - 1];
    const monto = convertirMonto(montoTexto);

    if (!monto || monto <= 0) {
      return;
    }

    const cuotaEncontrada = linea.match(/\b(\d{1,2})\s*\/\s*(\d{1,2})\b/);

    let cuotaActual = 1;
    let cuotas = 1;

    if (cuotaEncontrada) {
      cuotaActual = Number(cuotaEncontrada[1]);
      cuotas = Number(cuotaEncontrada[2]);

      if (cuotaActual > cuotas || cuotas > 60) {
        cuotaActual = 1;
        cuotas = 1;
      }
    }

    let descripcion = linea
      .replace(fechaEncontrada[0], "")
      .replace(montoTexto, "")
      .replace(/\b\d{1,2}\s*\/\s*\d{1,2}\b/g, "")
      .replace(/ARS/gi, "")
      .replace(/\$/g, "")
      .replace(/\s+/g, " ")
      .trim();

    if (descripcion.length < 3) {
      descripcion = "Consumo detectado";
    }

    gastosDetectados.push({
      id: crypto.randomUUID(),
      descripcion,
      categoria: cuotas > 1 ? "Cuotas" : "Consumo",
      montoTotal: cuotas > 1 ? monto * cuotas : monto,
      cuotas,
      cuotaActual,
      fechaCompra: convertirFecha(fechaEncontrada[0]),
      tarjeta: entidad,
      origen: "PDF",
      lineaOriginal: linea,
    });
  });

  return gastosDetectados;
}

export default function App() {
  const [gastos, setGastos] = useState(() =>
    normalizarGastos(cargarStorage(STORAGE_GASTOS, gastosIniciales))
  );

  const [resumenesPago, setResumenesPago] = useState(() =>
    cargarStorage(STORAGE_RESUMENES, [])
  );

  const [formulario, setFormulario] = useState(limpiarFormulario());
  const [formResumen, setFormResumen] = useState(limpiarResumen());

  const [textoPDF, setTextoPDF] = useState("");
  const [nombrePDF, setNombrePDF] = useState("");
  const [leyendoPDF, setLeyendoPDF] = useState(false);
  const [gastosPDF, setGastosPDF] = useState([]);
  const [resumenPDF, setResumenPDF] = useState(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_GASTOS, JSON.stringify(gastos));
  }, [gastos]);

  useEffect(() => {
    localStorage.setItem(STORAGE_RESUMENES, JSON.stringify(resumenesPago));
  }, [resumenesPago]);

  const gastosCalculados = useMemo(() => {
    return gastos.map((gasto) => {
      const valorCuota = gasto.montoTotal / gasto.cuotas;
      const cuotasPendientes = gasto.cuotas - gasto.cuotaActual;
      const fechaFinalizacion = sumarMeses(gasto.fechaCompra, gasto.cuotas - 1);

      return {
        ...gasto,
        valorCuota,
        cuotasPendientes,
        fechaFinalizacion,
      };
    });
  }, [gastos]);

  const resumenPorEntidad = useMemo(() => {
    const entidades = {};

    gastosCalculados.forEach((gasto) => {
      const entidad = gasto.tarjeta || "Sin entidad";

      if (!entidades[entidad]) {
        entidades[entidad] = {
          entidad,
          tipo: "Gastos",
          fechaPago: "",
          totalResumen: 0,
          pagoMinimo: 0,
          cuotasMes: 0,
          deudaPendiente: 0,
          consumos: [],
        };
      }

      entidades[entidad].cuotasMes += gasto.valorCuota;
      entidades[entidad].deudaPendiente += gasto.valorCuota * gasto.cuotasPendientes;
      entidades[entidad].consumos.push(gasto);
    });

    resumenesPago.forEach((resumen) => {
      const entidad = resumen.entidad || "Sin entidad";

      if (!entidades[entidad]) {
        entidades[entidad] = {
          entidad,
          tipo: resumen.tipo || "Tarjeta",
          fechaPago: "",
          totalResumen: 0,
          pagoMinimo: 0,
          cuotasMes: 0,
          deudaPendiente: 0,
          consumos: [],
        };
      }

      entidades[entidad].tipo = resumen.tipo || entidades[entidad].tipo;
      entidades[entidad].fechaPago = resumen.fechaPago || entidades[entidad].fechaPago;
      entidades[entidad].totalResumen += Number(resumen.totalPagar || 0);
      entidades[entidad].pagoMinimo += Number(resumen.pagoMinimo || 0);
    });

    return Object.values(entidades).map((item) => ({
      ...item,
      totalAPagarMes: item.totalResumen > 0 ? item.totalResumen : item.cuotasMes,
    }));
  }, [gastosCalculados, resumenesPago]);

  const totalAPagarMes = resumenPorEntidad.reduce(
    (total, item) => total + item.totalAPagarMes,
    0
  );

  const totalPagoMinimo = resumenPorEntidad.reduce(
    (total, item) => total + item.pagoMinimo,
    0
  );

  const totalCuotasMes = resumenPorEntidad.reduce(
    (total, item) => total + item.cuotasMes,
    0
  );

  const totalDeudaPendiente = resumenPorEntidad.reduce(
    (total, item) => total + item.deudaPendiente,
    0
  );

  const proyeccion = useMemo(() => {
    const meses = {};

    gastosCalculados.forEach((gasto) => {
      for (let i = gasto.cuotaActual; i < gasto.cuotas; i++) {
        const fecha = sumarMeses(gasto.fechaCompra, i);
        const mes = formatearMes(fecha);

        if (!meses[mes]) {
          meses[mes] = 0;
        }

        meses[mes] += gasto.valorCuota;
      }
    });

    return Object.entries(meses).map(([mes, total]) => ({
      mes,
      total,
    }));
  }, [gastosCalculados]);

  function actualizarFormulario(evento) {
    const { name, value } = evento.target;
    setFormulario({ ...formulario, [name]: value });
  }

  function actualizarResumen(evento) {
    const { name, value } = evento.target;
    setFormResumen({ ...formResumen, [name]: value });
  }

  function guardarGasto(evento) {
    evento.preventDefault();

    const gastoGuardado = {
      id: formulario.id || crypto.randomUUID(),
      descripcion: formulario.descripcion,
      categoria: formulario.categoria,
      montoTotal: Number(formulario.montoTotal),
      cuotas: Number(formulario.cuotas),
      cuotaActual: Number(formulario.cuotaActual),
      fechaCompra: formulario.fechaCompra,
      tarjeta: formulario.tarjeta,
    };

    if (gastoGuardado.cuotaActual > gastoGuardado.cuotas) {
      alert("La cuota actual no puede ser mayor que la cantidad total de cuotas.");
      return;
    }

    if (formulario.id) {
      setGastos(
        gastos.map((gasto) =>
          gasto.id === formulario.id ? gastoGuardado : gasto
        )
      );
    } else {
      setGastos([...gastos, gastoGuardado]);
    }

    setFormulario(limpiarFormulario());
  }

  function guardarResumen(evento) {
    evento.preventDefault();

    const resumenGuardado = {
      id: formResumen.id || crypto.randomUUID(),
      entidad: formResumen.entidad,
      tipo: formResumen.tipo,
      fechaPago: formResumen.fechaPago,
      totalPagar: Number(formResumen.totalPagar),
      pagoMinimo: Number(formResumen.pagoMinimo || 0),
    };

    if (formResumen.id) {
      setResumenesPago(
        resumenesPago.map((resumen) =>
          resumen.id === formResumen.id ? resumenGuardado : resumen
        )
      );
    } else {
      setResumenesPago([...resumenesPago, resumenGuardado]);
    }

    setFormResumen(limpiarResumen());
  }

  function editarResumen(resumen) {
    setFormResumen({
      id: resumen.id,
      entidad: resumen.entidad,
      tipo: resumen.tipo,
      fechaPago: resumen.fechaPago,
      totalPagar: resumen.totalPagar,
      pagoMinimo: resumen.pagoMinimo,
    });
  }

  function eliminarResumen(id) {
    if (!window.confirm("¿Querés eliminar este resumen de pago?")) {
      return;
    }

    setResumenesPago(resumenesPago.filter((resumen) => resumen.id !== id));
  }

  function cargarGastoParaEditar(gasto) {
    setFormulario({
      id: gasto.id,
      descripcion: gasto.descripcion,
      categoria: gasto.categoria,
      montoTotal: gasto.montoTotal,
      cuotas: gasto.cuotas,
      cuotaActual: gasto.cuotaActual,
      fechaCompra: gasto.fechaCompra,
      tarjeta: gasto.tarjeta,
    });

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function eliminarGasto(id) {
    if (!window.confirm("¿Querés eliminar este gasto?")) {
      return;
    }

    setGastos(gastos.filter((gasto) => gasto.id !== id));
  }

  function borrarTodo() {
    if (!window.confirm("¿Seguro que querés borrar todos los datos?")) {
      return;
    }

    setGastos([]);
    setResumenesPago([]);
    setFormulario(limpiarFormulario());
    setFormResumen(limpiarResumen());
  }

  async function leerPDF(evento) {
    const archivo = evento.target.files[0];

    if (!archivo) {
      return;
    }

    if (archivo.type !== "application/pdf") {
      alert("Por favor subí un archivo PDF.");
      return;
    }

    setLeyendoPDF(true);
    setNombrePDF(archivo.name);
    setTextoPDF("");
    setGastosPDF([]);
    setResumenPDF(null);

    try {
      const buffer = await archivo.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;

      let textoCompleto = "";

      for (let paginaNumero = 1; paginaNumero <= pdf.numPages; paginaNumero++) {
        const pagina = await pdf.getPage(paginaNumero);
        const contenido = await pagina.getTextContent();
        const textoPagina = extraerTextoOrdenado(contenido);

        textoCompleto += `\n\n--- Página ${paginaNumero} ---\n${textoPagina}`;
      }

      const textoFinal = textoCompleto.trim();
      const gastosDetectados = detectarGastosDesdeTexto(textoFinal, archivo.name);
      const resumenDetectado = detectarResumenPago(textoFinal, archivo.name);

      setTextoPDF(textoFinal);
      setGastosPDF(gastosDetectados);
      setResumenPDF(resumenDetectado);
    } catch (error) {
      console.error(error);
      alert("No se pudo leer el PDF. Puede estar protegido o venir como imagen.");
    } finally {
      setLeyendoPDF(false);
    }
  }

  
  function actualizarResumenPDF(campo, valor) {
    if (!resumenPDF) {
      return;
    }

    setResumenPDF({
      ...resumenPDF,
      [campo]: valor,
    });
  }

function importarTodoPDF() {
    let importoAlgo = false;

    if (resumenPDF) {
      setResumenesPago([...resumenesPago, resumenPDF]);
      setResumenPDF(null);
      importoAlgo = true;
    }

    if (gastosPDF.length > 0) {
      setGastos([...gastos, ...gastosPDF]);
      setGastosPDF([]);
      importoAlgo = true;
    }

    if (importoAlgo) {
      alert("Resumen y consumos importados correctamente.");
    } else {
      alert("No hay datos detectados para importar.");
    }
  }

  function eliminarGastoDetectado(id) {
    setGastosPDF(gastosPDF.filter((gasto) => gasto.id !== id));
  }

  function limpiarPDF() {
    setTextoPDF("");
    setNombrePDF("");
    setGastosPDF([]);
    setResumenPDF(null);
  }

  return (
    <main className="contenedor">
      <section className="hero">
        <p className="etiqueta">Dashboard financiero personal</p>
        <h1>Resumen mensual completo</h1>
        <p>
          Visualizá el total a pagar del mes, pago mínimo, fechas de pago,
          bancos, tarjetas, préstamos y consumos detectados desde PDF.
        </p>
      </section>

      <section className="resumen resumen-principal">
        <div className="tarjeta tarjeta-destacada">
          <span>Total a pagar del mes</span>
          <strong>{formatearDinero(totalAPagarMes)}</strong>
        </div>

        <div className="tarjeta">
          <span>Pago mínimo total</span>
          <strong>{formatearDinero(totalPagoMinimo)}</strong>
        </div>

        <div className="tarjeta">
          <span>Cuotas del mes</span>
          <strong>{formatearDinero(totalCuotasMes)}</strong>
        </div>

        <div className="tarjeta">
          <span>Deuda pendiente futura</span>
          <strong>{formatearDinero(totalDeudaPendiente)}</strong>
        </div>

        <div className="tarjeta">
          <span>Entidades</span>
          <strong>{resumenPorEntidad.length}</strong>
        </div>

        <div className="tarjeta">
          <span>Consumos cargados</span>
          <strong>{gastos.length}</strong>
        </div>
      </section>

      <section className="panel">
        <div className="encabezado-panel">
          <h2>Total a pagar por banco / tarjeta</h2>

          {(gastos.length > 0 || resumenesPago.length > 0) && (
            <button className="boton-peligro" onClick={borrarTodo}>
              Borrar todo
            </button>
          )}
        </div>

        <div className="tabla">
          <table>
            <thead>
              <tr>
                <th>Banco / Tarjeta</th>
                <th>Tipo</th>
                <th>Fecha de pago</th>
                <th>Total a pagar</th>
                <th>Pago mínimo</th>
                <th>Cuotas/consumos del mes</th>
                <th>Deuda futura</th>
                <th>Consumos</th>
              </tr>
            </thead>

            <tbody>
              {resumenPorEntidad.map((item) => (
                <tr key={item.entidad}>
                  <td>{item.entidad}</td>
                  <td>{item.tipo}</td>
                  <td>{item.fechaPago || "Sin dato"}</td>
                  <td className="monto-importante">
                    {formatearDinero(item.totalAPagarMes)}
                  </td>
                  <td>{formatearDinero(item.pagoMinimo)}</td>
                  <td>{formatearDinero(item.cuotasMes)}</td>
                  <td>{formatearDinero(item.deudaPendiente)}</td>
                  <td>{item.consumos.length}</td>
                </tr>
              ))}

              {resumenPorEntidad.length === 0 && (
                <tr>
                  <td colSpan="8" className="vacio">
                    Todavía no hay datos. Subí un PDF o cargá un resumen manual.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="encabezado-panel">
          <div>
            <h2>Cargar resumen bancario en PDF</h2>
            <p className="texto-ayuda">
              La app detecta el total a pagar, pago mínimo, fecha de pago y
              consumos/cuotas del resumen.
            </p>
          </div>

          {(textoPDF || gastosPDF.length > 0 || resumenPDF) && (
            <button className="boton-secundario" onClick={limpiarPDF}>
              Limpiar PDF
            </button>
          )}
        </div>

        <input type="file" accept="application/pdf" onChange={leerPDF} />

        {leyendoPDF && <p className="modo-edicion">Leyendo y analizando PDF...</p>}

        {nombrePDF && !leyendoPDF && (
          <p className="modo-edicion">
            PDF cargado: <strong>{nombrePDF}</strong>
          </p>
        )}

        {(resumenPDF || gastosPDF.length > 0) && (
          <div className="bloque-detectados">
            <div className="encabezado-panel">
              <h3>Datos detectados del resumen</h3>
              <button onClick={importarTodoPDF}>Importar resumen completo</button>
            </div>

            {resumenPDF && (
              <div className="resumen-detectado-editable">
                <p className="advertencia-suave">
                  Revisá estos datos antes de importar. Algunos bancos entregan el
                  texto del PDF desordenado y puede ser necesario corregirlos.
                </p>

                <div className="form-resumen-detectado">
                  <label>
                    Banco / Tarjeta
                    <input
                      value={resumenPDF.entidad}
                      onChange={(evento) =>
                        actualizarResumenPDF("entidad", evento.target.value)
                      }
                    />
                  </label>

                  <label>
                    Fecha de pago
                    <input
                      type="date"
                      value={resumenPDF.fechaPago || ""}
                      onChange={(evento) =>
                        actualizarResumenPDF("fechaPago", evento.target.value)
                      }
                    />
                  </label>

                  <label>
                    Total a pagar del resumen
                    <input
                      type="number"
                      value={resumenPDF.totalPagar ?? ""}
                      onChange={(evento) =>
                        actualizarResumenPDF(
                          "totalPagar",
                          Number(evento.target.value)
                        )
                      }
                    />
                  </label>

                  <label>
                    Pago mínimo
                    <input
                      type="number"
                      value={resumenPDF.pagoMinimo ?? ""}
                      onChange={(evento) =>
                        actualizarResumenPDF(
                          "pagoMinimo",
                          Number(evento.target.value)
                        )
                      }
                    />
                  </label>
                </div>

                <div className="cards-mini">
                  <div>
                    <span>Total a pagar</span>
                    <strong>{formatearDinero(resumenPDF.totalPagar)}</strong>
                  </div>

                  <div>
                    <span>Pago mínimo</span>
                    <strong>{formatearDinero(resumenPDF.pagoMinimo)}</strong>
                  </div>

                  <div>
                    <span>Fecha de pago</span>
                    <strong>{resumenPDF.fechaPago || "Sin dato"}</strong>
                  </div>

                  <div>
                    <span>Entidad</span>
                    <strong>{resumenPDF.entidad}</strong>
                  </div>
                </div>
              </div>
            )}

            <h3>Consumos detectados</h3>

            <div className="tabla">
              <table>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Descripción</th>
                    <th>Categoría</th>
                    <th>Entidad</th>
                    <th>Monto total</th>
                    <th>Cuotas</th>
                    <th>Acción</th>
                  </tr>
                </thead>

                <tbody>
                  {gastosPDF.map((gasto) => (
                    <tr key={gasto.id}>
                      <td>{gasto.fechaCompra}</td>
                      <td>{gasto.descripcion}</td>
                      <td>{gasto.categoria}</td>
                      <td>{gasto.tarjeta}</td>
                      <td>{formatearDinero(gasto.montoTotal)}</td>
                      <td>
                        {gasto.cuotaActual}/{gasto.cuotas}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="boton-eliminar"
                          onClick={() => eliminarGastoDetectado(gasto.id)}
                        >
                          Quitar
                        </button>
                      </td>
                    </tr>
                  ))}

                  {gastosPDF.length === 0 && (
                    <tr>
                      <td colSpan="7" className="vacio">
                        No se detectaron consumos en este PDF.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {textoPDF && (
          <details className="detalle-pdf">
            <summary>Ver texto extraído del PDF</summary>
            <textarea className="visor-pdf" value={textoPDF} readOnly />
          </details>
        )}
      </section>

      <section className="grid">
        <form className="panel" onSubmit={guardarResumen}>
          <h2>{formResumen.id ? "Editar resumen de pago" : "Cargar resumen de pago manual"}</h2>

          <input
            name="entidad"
            placeholder="Banco o tarjeta. Ej: Visa BBVA"
            value={formResumen.entidad}
            onChange={actualizarResumen}
            required
          />

          <select name="tipo" value={formResumen.tipo} onChange={actualizarResumen}>
            <option value="Tarjeta">Tarjeta</option>
            <option value="Préstamo">Préstamo</option>
            <option value="Servicio">Servicio</option>
            <option value="Otro">Otro</option>
          </select>

          <input
            name="fechaPago"
            type="date"
            value={formResumen.fechaPago}
            onChange={actualizarResumen}
            required
          />

          <input
            name="totalPagar"
            type="number"
            placeholder="Total a pagar"
            value={formResumen.totalPagar}
            onChange={actualizarResumen}
            min="0"
            required
          />

          <input
            name="pagoMinimo"
            type="number"
            placeholder="Pago mínimo"
            value={formResumen.pagoMinimo}
            onChange={actualizarResumen}
            min="0"
          />

          <button type="submit">
            {formResumen.id ? "Guardar resumen" : "Agregar resumen"}
          </button>
        </form>

        <section className="panel">
          <h2>Resúmenes de pago cargados</h2>

          <div className="lista">
            {resumenesPago.map((resumen) => (
              <div className="fila resumen-fila" key={resumen.id}>
                <div>
                  <strong>{resumen.entidad}</strong>
                  <span>{resumen.tipo} · Pago: {resumen.fechaPago || "Sin dato"}</span>
                  <span>
                    Total: {formatearDinero(resumen.totalPagar)} · Mínimo:{" "}
                    {formatearDinero(resumen.pagoMinimo)}
                  </span>
                </div>

                <div className="acciones">
                  <button className="boton-editar" onClick={() => editarResumen(resumen)}>
                    Editar
                  </button>

                  <button className="boton-eliminar" onClick={() => eliminarResumen(resumen.id)}>
                    Eliminar
                  </button>
                </div>
              </div>
            ))}

            {resumenesPago.length === 0 && (
              <p className="vacio">No hay resúmenes cargados.</p>
            )}
          </div>
        </section>
      </section>

      <section className="panel">
        <h2>Detalle de consumos por banco / tarjeta</h2>

        {resumenPorEntidad.map((entidad) => (
          <div className="detalle-entidad" key={entidad.entidad}>
            <div className="encabezado-panel">
              <div>
                <h3>{entidad.entidad}</h3>
                <p className="texto-ayuda">
                  Total a pagar: {formatearDinero(entidad.totalAPagarMes)} ·
                  Pago mínimo: {formatearDinero(entidad.pagoMinimo)} ·
                  Fecha de pago: {entidad.fechaPago || "Sin dato"}
                </p>
              </div>
            </div>

            <div className="tabla">
              <table>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Descripción</th>
                    <th>Categoría</th>
                    <th>Cuota</th>
                    <th>Valor cuota</th>
                    <th>Total compra</th>
                    <th>Finaliza</th>
                    <th>Acción</th>
                  </tr>
                </thead>

                <tbody>
                  {entidad.consumos.map((gasto) => (
                    <tr key={gasto.id}>
                      <td>{gasto.fechaCompra}</td>
                      <td>{gasto.descripcion}</td>
                      <td>{gasto.categoria}</td>
                      <td>
                        {gasto.cuotaActual}/{gasto.cuotas}
                      </td>
                      <td>{formatearDinero(gasto.valorCuota)}</td>
                      <td>{formatearDinero(gasto.montoTotal)}</td>
                      <td>{formatearMes(gasto.fechaFinalizacion)}</td>
                      <td>
                        <div className="acciones">
                          <button
                            type="button"
                            className="boton-editar"
                            onClick={() => cargarGastoParaEditar(gasto)}
                          >
                            Editar
                          </button>

                          <button
                            type="button"
                            className="boton-eliminar"
                            onClick={() => eliminarGasto(gasto.id)}
                          >
                            Eliminar
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}

                  {entidad.consumos.length === 0 && (
                    <tr>
                      <td colSpan="8" className="vacio">
                        No hay consumos detectados para esta entidad.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </section>

      <section className="grid">
        <form className="panel" onSubmit={guardarGasto}>
          <h2>{formulario.id ? "Editar consumo" : "Cargar consumo manual"}</h2>

          {formulario.id && (
            <p className="modo-edicion">
              Editando: <strong>{formulario.descripcion}</strong>
            </p>
          )}

          <input
            name="descripcion"
            placeholder="Descripción"
            value={formulario.descripcion}
            onChange={actualizarFormulario}
            required
          />

          <input
            name="categoria"
            placeholder="Categoría"
            value={formulario.categoria}
            onChange={actualizarFormulario}
            required
          />

          <input
            name="montoTotal"
            type="number"
            placeholder="Monto total"
            value={formulario.montoTotal}
            onChange={actualizarFormulario}
            min="1"
            required
          />

          <input
            name="cuotas"
            type="number"
            placeholder="Cantidad total de cuotas"
            value={formulario.cuotas}
            onChange={actualizarFormulario}
            min="1"
            required
          />

          <input
            name="cuotaActual"
            type="number"
            placeholder="Cuota actual"
            value={formulario.cuotaActual}
            onChange={actualizarFormulario}
            min="0"
            required
          />

          <input
            name="fechaCompra"
            type="date"
            value={formulario.fechaCompra}
            onChange={actualizarFormulario}
            required
          />

          <input
            name="tarjeta"
            placeholder="Tarjeta, banco o entidad"
            value={formulario.tarjeta}
            onChange={actualizarFormulario}
            required
          />

          <button type="submit">
            {formulario.id ? "Guardar cambios" : "Agregar consumo"}
          </button>

          {formulario.id && (
            <button
              type="button"
              className="boton-secundario"
              onClick={() => setFormulario(limpiarFormulario())}
            >
              Cancelar edición
            </button>
          )}
        </form>

        <section className="panel">
          <h2>Proyección futura de cuotas</h2>

          <div className="lista">
            {proyeccion.length === 0 ? (
              <p className="vacio">No hay cuotas futuras cargadas.</p>
            ) : (
              proyeccion.map((item) => (
                <div className="fila" key={item.mes}>
                  <span>{item.mes}</span>
                  <strong>{formatearDinero(item.total)}</strong>
                </div>
              ))
            )}
          </div>
        </section>
      </section>
    </main>
  );
}
