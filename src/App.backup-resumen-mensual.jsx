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

const gastosIniciales = [
  {
    id: crypto.randomUUID(),
    descripcion: "Celular Samsung",
    categoria: "Tecnología",
    montoTotal: 600000,
    cuotas: 12,
    cuotaActual: 3,
    fechaCompra: "2026-06-01",
    tarjeta: "Visa BBVA",
  },
  {
    id: crypto.randomUUID(),
    descripcion: "Préstamo personal",
    categoria: "Préstamo",
    montoTotal: 1200000,
    cuotas: 24,
    cuotaActual: 5,
    fechaCompra: "2026-01-10",
    tarjeta: "Santander",
  },
];

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
    montoTotal: Number(gasto.montoTotal),
    cuotas: Number(gasto.cuotas),
    cuotaActual: Number(gasto.cuotaActual),
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

  lineas.forEach((linea) => {
    const lineaLower = linea.toLowerCase();

    const fechas = linea.match(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g);
    const montos = linea.match(
      /(?:\$|ARS)?\s*-?\d{1,3}(?:\.\d{3})+(?:,\d{2})?|(?:\$|ARS)?\s*-?\d+,\d{2}/gi
    );

    if (
      !fechaPago &&
      fechas &&
      (lineaLower.includes("vencimiento") ||
        lineaLower.includes("fecha de pago") ||
        lineaLower.includes("pagar hasta") ||
        lineaLower.includes("fecha límite") ||
        lineaLower.includes("fecha limite"))
    ) {
      fechaPago = convertirFecha(fechas[fechas.length - 1]);
    }

    if (
      montos &&
      (lineaLower.includes("total a pagar") ||
        lineaLower.includes("saldo total") ||
        lineaLower.includes("pago total") ||
        lineaLower.includes("total del resumen") ||
        lineaLower.includes("importe total"))
    ) {
      totalPagar = convertirMonto(montos[montos.length - 1]);
    }

    if (
      montos &&
      (lineaLower.includes("pago mínimo") ||
        lineaLower.includes("pago minimo") ||
        lineaLower.includes("mínimo") ||
        lineaLower.includes("minimo"))
    ) {
      pagoMinimo = convertirMonto(montos[montos.length - 1]);
    }
  });

  if (!fechaPago && lineas.length > 0) {
    const primeraFecha = textoPDF.match(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/);
    if (primeraFecha) {
      fechaPago = convertirFecha(primeraFecha[0]);
    }
  }

  if (!totalPagar) {
    return null;
  }

  return {
    id: crypto.randomUUID(),
    entidad,
    tipo: entidad.toLowerCase().includes("prestamo") ? "Préstamo" : "Tarjeta",
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

  const totalMensual = gastosCalculados.reduce(
    (total, gasto) => total + gasto.valorCuota,
    0
  );

  const totalDeudaPendiente = gastosCalculados.reduce(
    (total, gasto) => total + gasto.valorCuota * gasto.cuotasPendientes,
    0
  );

  const totalResumenes = resumenesPago.reduce(
    (total, resumen) => total + Number(resumen.totalPagar || 0),
    0
  );

  const totalPagoMinimo = resumenesPago.reduce(
    (total, resumen) => total + Number(resumen.pagoMinimo || 0),
    0
  );

  const totalPrestamos = gastosCalculados
    .filter((gasto) => gasto.categoria.toLowerCase().includes("préstamo") || gasto.categoria.toLowerCase().includes("prestamo"))
    .reduce((total, gasto) => total + gasto.valorCuota, 0);

  const resumenPorEntidad = useMemo(() => {
    const entidades = {};

    gastosCalculados.forEach((gasto) => {
      const entidad = gasto.tarjeta || "Sin entidad";

      if (!entidades[entidad]) {
        entidades[entidad] = {
          entidad,
          cuotaMensual: 0,
          deudaPendiente: 0,
          cantidadGastos: 0,
          totalResumen: 0,
          pagoMinimo: 0,
          fechaPago: "",
          tipo: "Gastos",
        };
      }

      entidades[entidad].cuotaMensual += gasto.valorCuota;
      entidades[entidad].deudaPendiente += gasto.valorCuota * gasto.cuotasPendientes;
      entidades[entidad].cantidadGastos += 1;
    });

    resumenesPago.forEach((resumen) => {
      const entidad = resumen.entidad || "Sin entidad";

      if (!entidades[entidad]) {
        entidades[entidad] = {
          entidad,
          cuotaMensual: 0,
          deudaPendiente: 0,
          cantidadGastos: 0,
          totalResumen: 0,
          pagoMinimo: 0,
          fechaPago: "",
          tipo: resumen.tipo || "Tarjeta",
        };
      }

      entidades[entidad].totalResumen += Number(resumen.totalPagar || 0);
      entidades[entidad].pagoMinimo += Number(resumen.pagoMinimo || 0);
      entidades[entidad].fechaPago = resumen.fechaPago || entidades[entidad].fechaPago;
      entidades[entidad].tipo = resumen.tipo || entidades[entidad].tipo;
    });

    return Object.values(entidades).sort((a, b) =>
      a.entidad.localeCompare(b.entidad)
    );
  }, [gastosCalculados, resumenesPago]);

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

    setFormulario({
      ...formulario,
      [name]: value,
    });
  }

  function actualizarResumen(evento) {
    const { name, value } = evento.target;

    setFormResumen({
      ...formResumen,
      [name]: value,
    });
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

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  function cancelarEdicion() {
    setFormulario(limpiarFormulario());
  }

  function eliminarGasto(id) {
    if (!window.confirm("¿Querés eliminar este gasto?")) {
      return;
    }

    setGastos(gastos.filter((gasto) => gasto.id !== id));
  }

  function borrarTodo() {
    if (!window.confirm("¿Seguro que querés borrar todos los gastos cargados?")) {
      return;
    }

    setGastos([]);
    setFormulario(limpiarFormulario());
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

  function importarGastosPDF() {
    if (gastosPDF.length === 0) {
      alert("No hay gastos detectados para importar.");
      return;
    }

    setGastos([...gastos, ...gastosPDF]);
    setGastosPDF([]);
    alert("Gastos importados correctamente.");
  }

  function importarResumenPDF() {
    if (!resumenPDF) {
      alert("No hay resumen detectado para importar.");
      return;
    }

    setResumenesPago([...resumenesPago, resumenPDF]);
    setResumenPDF(null);
    alert("Resumen de pago importado correctamente.");
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
        <h1>Resumen completo de gastos, tarjetas y préstamos</h1>
        <p>
          Subí resúmenes bancarios en PDF, detectá consumos automáticamente y
          visualizá totales por banco, tarjeta, fecha de pago, pago mínimo y préstamos.
        </p>
      </section>

      <section className="resumen">
        <div className="tarjeta">
          <span>Total mensual por cuotas</span>
          <strong>{formatearDinero(totalMensual)}</strong>
        </div>

        <div className="tarjeta">
          <span>Total a pagar en resúmenes</span>
          <strong>{formatearDinero(totalResumenes)}</strong>
        </div>

        <div className="tarjeta">
          <span>Pago mínimo total</span>
          <strong>{formatearDinero(totalPagoMinimo)}</strong>
        </div>

        <div className="tarjeta">
          <span>Deuda pendiente</span>
          <strong>{formatearDinero(totalDeudaPendiente)}</strong>
        </div>

        <div className="tarjeta">
          <span>Préstamos mensuales</span>
          <strong>{formatearDinero(totalPrestamos)}</strong>
        </div>

        <div className="tarjeta">
          <span>Gastos cargados</span>
          <strong>{gastos.length}</strong>
        </div>
      </section>

      <section className="panel">
        <h2>Resumen por banco, tarjeta o entidad</h2>

        <div className="tabla">
          <table>
            <thead>
              <tr>
                <th>Entidad</th>
                <th>Tipo</th>
                <th>Fecha de pago</th>
                <th>Total resumen</th>
                <th>Pago mínimo</th>
                <th>Cuotas del mes</th>
                <th>Deuda pendiente</th>
                <th>Gastos</th>
              </tr>
            </thead>

            <tbody>
              {resumenPorEntidad.map((item) => (
                <tr key={item.entidad}>
                  <td>{item.entidad}</td>
                  <td>{item.tipo}</td>
                  <td>{item.fechaPago || "Sin dato"}</td>
                  <td>{formatearDinero(item.totalResumen)}</td>
                  <td>{formatearDinero(item.pagoMinimo)}</td>
                  <td>{formatearDinero(item.cuotaMensual)}</td>
                  <td>{formatearDinero(item.deudaPendiente)}</td>
                  <td>{item.cantidadGastos}</td>
                </tr>
              ))}

              {resumenPorEntidad.length === 0 && (
                <tr>
                  <td colSpan="8" className="vacio">
                    Todavía no hay datos para mostrar.
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
              La app intentará detectar consumos, cuotas, total a pagar,
              pago mínimo y fecha de vencimiento.
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

        {resumenPDF && (
          <div className="bloque-detectados">
            <div className="encabezado-panel">
              <h3>Resumen de pago detectado</h3>
              <button onClick={importarResumenPDF}>Importar resumen</button>
            </div>

            <div className="cards-mini">
              <div>
                <span>Entidad</span>
                <strong>{resumenPDF.entidad}</strong>
              </div>

              <div>
                <span>Fecha de pago</span>
                <strong>{resumenPDF.fechaPago || "Sin dato"}</strong>
              </div>

              <div>
                <span>Total a pagar</span>
                <strong>{formatearDinero(resumenPDF.totalPagar)}</strong>
              </div>

              <div>
                <span>Pago mínimo</span>
                <strong>{formatearDinero(resumenPDF.pagoMinimo)}</strong>
              </div>
            </div>
          </div>
        )}

        {gastosPDF.length > 0 && (
          <div className="bloque-detectados">
            <div className="encabezado-panel">
              <h3>Gastos detectados automáticamente</h3>

              <button onClick={importarGastosPDF}>
                Importar {gastosPDF.length} gastos
              </button>
            </div>

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
          <h2>Resúmenes cargados</h2>

          <div className="lista">
            {resumenesPago.map((resumen) => (
              <div className="fila resumen-fila" key={resumen.id}>
                <div>
                  <strong>{resumen.entidad}</strong>
                  <span>
                    {resumen.tipo} · Pago: {resumen.fechaPago || "Sin dato"}
                  </span>
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
              <p className="vacio">No hay resúmenes de pago cargados.</p>
            )}
          </div>
        </section>
      </section>

      <section className="grid">
        <form className="panel" onSubmit={guardarGasto}>
          <h2>{formulario.id ? "Editar gasto" : "Cargar gasto manual"}</h2>

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
            {formulario.id ? "Guardar cambios" : "Agregar gasto"}
          </button>

          {formulario.id && (
            <button
              type="button"
              className="boton-secundario"
              onClick={cancelarEdicion}
            >
              Cancelar edición
            </button>
          )}
        </form>

        <section className="panel">
          <h2>Proyección futura</h2>

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

      <section className="panel">
        <div className="encabezado-panel">
          <h2>Cuotas activas</h2>

          {gastos.length > 0 && (
            <button className="boton-peligro" onClick={borrarTodo}>
              Borrar todo
            </button>
          )}
        </div>

        <div className="tabla">
          <table>
            <thead>
              <tr>
                <th>Descripción</th>
                <th>Categoría</th>
                <th>Entidad</th>
                <th>Cuota</th>
                <th>Valor cuota</th>
                <th>Pendientes</th>
                <th>Finaliza</th>
                <th>Acción</th>
              </tr>
            </thead>

            <tbody>
              {gastosCalculados.map((gasto) => (
                <tr key={gasto.id}>
                  <td>{gasto.descripcion}</td>
                  <td>{gasto.categoria}</td>
                  <td>{gasto.tarjeta}</td>
                  <td>
                    {gasto.cuotaActual}/{gasto.cuotas}
                  </td>
                  <td>{formatearDinero(gasto.valorCuota)}</td>
                  <td>{gasto.cuotasPendientes}</td>
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

              {gastosCalculados.length === 0 && (
                <tr>
                  <td colSpan="8" className="vacio">
                    No hay gastos cargados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
